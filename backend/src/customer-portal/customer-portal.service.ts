import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
// Nest 10 has no `TooManyRequestsException`, and the route-level limiter throws
// `ThrottlerException` for the same condition. Reusing it keeps one 429 shape
// for the whole app instead of two subtly different ones.
import { ThrottlerException } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { SecurityService } from '../common/crypto/security.service';
import { CustomerRegisterDto, CustomerLoginDto } from './dto/customer-portal.dto';

/**
 * A real Argon2id hash of a value nobody can supply. Verifying against it when
 * the account does not exist keeps the timing of "no such account" and "wrong
 * password" indistinguishable, so the sign-in form cannot be used to find out
 * which addresses have portal accounts.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$8YyR0hUkFvSUE9U1YyOVpXQnF0T3dxQ0x6SVo1eEc';

/**
 * The customer-facing side of the licensing system.
 *
 * The customer signs up here to reach their own dashboard. This is a separate
 * identity space from the Admin panel on purpose:
 *
 *   - an admin JWT must never open the customer portal, and the reverse. Mixing
 *     them would mean a stolen customer password escalating into the panel that
 *     controls every licence, so both tokens carry a different audience and
 *     each guard checks it.
 *   - the customer sees only their own licences and devices. Every query is
 *     scoped by the customerId from the verified token, never from a request
 *     parameter, so one customer cannot read another's data by editing a URL.
 *
 * The owner never has to create these accounts: the panel can still add a
 * customer by hand, in which case password_hash stays NULL.
 */
@Injectable()
export class CustomerPortalService {
  private readonly logger = new Logger(CustomerPortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly security: SecurityService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------- signup

  async register(dto: CustomerRegisterDto, req: Request) {
    const email = dto.email.trim().toLowerCase();

    if (await this.prisma.customer.findUnique({ where: { email } })) {
      throw new ConflictException('An account with this email already exists.');
    }

    // The admin password policy applies here too: this password is what gates
    // a 200MB download, so a weak one here is a weak one everywhere.
    const problems = SecurityService.assertPasswordStrength(dto.password);
    if (problems.length) {
      throw new BadRequestException({
        message: 'The password does not meet the required complexity.',
        details: problems,
      });
    }

    const customer = await this.prisma.customer.create({
      data: {
        email,
        name: dto.name.trim(),
        company: dto.company?.trim() || null,
        phone: dto.phone?.trim() || null,
        country: dto.country?.trim() || null,
        passwordHash: await this.security.hashPassword(dto.password),
        // Never taken from the request: registering must not grant a download.
        downloadEnabled: false,
        status: 'ACTIVE',
      },
    });

    this.logger.log(`Portal account created for ${customer.email} (id ${customer.id})`);
    await this.recordAudit(req, customer.id, 'CUSTOMER_REGISTERED');
    return this.issueSession(customer);
  }

  // ----------------------------------------------------------------- login

  /**
   * Per-account sign-in throttling.
   *
   * The route-level limit is per IP, which is the wrong unit for the case that
   * actually matters: an attacker grinding one stolen email list from a botnet
   * never trips a per-IP ceiling at all. This counts failures per email address
   * instead, so the attack is capped no matter how many addresses it comes from.
   *
   * A fixed window is enough here because the cost of a wrong guess is a full
   * Argon2id verify. The counter is in memory by design: losing it on restart
   * costs an attacker a pause, not access.
   */
  private readonly failedSignIns = new Map<string, { count: number; firstAt: number }>();

  private static readonly MAX_SIGN_IN_FAILURES = 5;
  private static readonly SIGN_IN_WINDOW_MS = 15 * 60_000;

  /** Throws when this address has recently failed too many times. */
  private assertNotLockedOut(email: string): void {
    const entry = this.failedSignIns.get(email);
    if (!entry) return;

    // The window has passed, so the record is stale and gets cleared lazily
    // rather than by a timer that would keep the event loop busy.
    if (Date.now() - entry.firstAt > CustomerPortalService.SIGN_IN_WINDOW_MS) {
      this.failedSignIns.delete(email);
      return;
    }
    if (entry.count >= CustomerPortalService.MAX_SIGN_IN_FAILURES) {
      throw new ThrottlerException(
        'Too many failed attempts. Please wait 15 minutes before trying again.',
      );
    }
  }

  private noteSignInFailure(email: string): void {
    const entry = this.failedSignIns.get(email);
    if (!entry || Date.now() - entry.firstAt > CustomerPortalService.SIGN_IN_WINDOW_MS) {
      this.failedSignIns.set(email, { count: 1, firstAt: Date.now() });
      return;
    }
    entry.count += 1;
  }

  private clearSignInFailures(email: string): void {
    this.failedSignIns.delete(email);
  }

  async login(dto: CustomerLoginDto, req: Request) {
    const email = dto.email.trim().toLowerCase();

    this.assertNotLockedOut(email);

    const customer = await this.prisma.customer.findUnique({ where: { email } });

    const ok = await this.security.verifyPassword(
      dto.password,
      // The dummy hash keeps the timing identical whether or not the address
      // exists, so a probe cannot enumerate which emails are registered.
      customer?.passwordHash ?? DUMMY_HASH,
    );

    if (!customer || !customer.passwordHash || !ok) {
      this.noteSignInFailure(email);
      this.logger.warn(`Failed portal sign-in for ${email}`);
      throw new UnauthorizedException('Incorrect email or password.');
    }

    this.clearSignInFailures(email);

    if (customer.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }
    if (customer.status === 'INACTIVE') {
      throw new ForbiddenException('This account is not active. Please contact support.');
    }

    await this.prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() },
    });

    await this.recordAudit(req, customer.id, 'CUSTOMER_LOGIN');
    return this.issueSession(customer);
  }

  // --------------------------------------------------------------- session

  private async issueSession(customer: {
    id: number;
    email: string;
    name: string;
    company: string | null;
    downloadEnabled: boolean;
  }) {
    // The audience claim is what stops a portal token being replayed against
    // the admin endpoints and the reverse. Both guards check it on every
    // request, so the separation holds even though one secret signs both.
    const accessToken = await this.jwt.signAsync(
      { sub: String(customer.id), email: customer.email, name: customer.name },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET', ''),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '30m'),
        audience: 'customer-portal',
        issuer: 'awexen',
      },
    );

    return {
      accessToken,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        company: customer.company,
        // Returned so the portal can explain why the download button is
        // disabled, instead of the customer assuming the site is broken.
        downloadEnabled: customer.downloadEnabled,
      },
    };
  }

  // ------------------------------------------------------------------ self

  async me(customerId: number) {
    const c = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      company: c.company,
      phone: c.phone,
      country: c.country,
      status: c.status,
      downloadEnabled: c.downloadEnabled,
      lastLoginAt: c.lastLoginAt,
      createdAt: c.createdAt,
    };
  }

  /** The whole dashboard: this customer's licences, their devices, the release. */
  async overview(customerId: number) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });

    const [licenses, release] = await Promise.all([
      this.prisma.license.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        include: {
          plan: { select: { key: true, name: true, nameAr: true } },
          devices: {
            where: { status: { not: 'REVOKED' } },
            select: { id: true, deviceName: true, status: true, lastSeenAt: true, createdAt: true },
          },
        },
      }),
      this.prisma.appVersion.findFirst({
        where: { platform: 'WINDOWS', status: 'PUBLISHED' },
        orderBy: [{ releasedAt: 'desc' }, { buildNumber: 'desc' }],
        select: { version: true, buildNumber: true, fileSize: true, releasedAt: true, releaseNotes: true },
      }),
    ]);

    return {
      customer: await this.me(customerId),
      licenses: licenses.map((l) => ({
        id: l.id,
        licenseKey: this.maskKey(l.licenseKey),
        plan: l.plan,
        status: l.status,
        isTrial: l.isTrial,
        startsAt: l.startsAt,
        expiresAt: l.expiresAt,
        maxDevices: l.maxDevices,
        version: l.version,
        devices: l.devices,
        lastValidationAt: l.lastValidationAt,
      })),
      latestRelease: release,
      // A single flag the portal renders the download gate from.
      canDownload: customer.downloadEnabled,
    };
  }

  /**
   * The full licence keys.
   *
   * A separate call from `overview`, which masks them. Showing an almost
   * complete key on the dashboard would leave most of the secret in the page
   * and in browser memory; this is the only place the real value is returned,
   * and only when the customer asks for it.
   */
  async licenseKeys(customerId: number) {
    const licenses = await this.prisma.license.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        licenseKey: true,
        status: true,
        expiresAt: true,
        plan: { select: { name: true, nameAr: true } },
      },
    });
    return { data: licenses };
  }

  private maskKey(key: string): string {
    if (key.length <= 12) return key;
    return `${key.slice(0, 8)}${'*'.repeat(8)}${key.slice(-4)}`;
  }

  // -------------------------------------------------------------- download

  /**
   * Resolves the installer for a paying customer.
   *
   * The payment gate lives here and nowhere else. Registration alone must not
   * be enough: a throwaway address would otherwise be able to pull a 200MB
   * installer, so the owner has to confirm payment first.
   */
  async download(customerId: number) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });

    if (!customer.downloadEnabled) {
      throw new ForbiddenException({
        code: 'PAYMENT_PENDING',
        message:
          'The download unlocks once payment is confirmed. Our team will email you as soon as it is.',
      });
    }

    const release = await this.prisma.appVersion.findFirst({
      where: { platform: 'WINDOWS', status: 'PUBLISHED' },
      orderBy: [{ releasedAt: 'desc' }, { buildNumber: 'desc' }],
      select: {
        version: true,
        buildNumber: true,
        downloadUrl: true,
        fileSize: true,
        checksum: true,
        releasedAt: true,
      },
    });

    // A missing release is an owner-side configuration problem rather than the
    // customer's fault, so it is a 404 and not a 403.
    if (!release || !release.downloadUrl) {
      throw new NotFoundException('No installer is available yet. Please contact support.');
    }

    return { release };
  }

  // -------------------------------------------------------- activation request

  /**
   * The plans a customer can pick from when requesting an activation code.
   */
  async catalogue() {
    const plans = await this.prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        nameAr: true,
        price: true,
        currency: true,
        billingInterval: true,
        trialDays: true,
        maxDevices: true,
        description: true,
      },
    });
    return { plans };
  }

  /**
   * The customer asks for an activation code and attaches the bank-transfer
   * receipt.
   *
   * The row lands in the owner's Payments screen as PENDING, which is the review
   * queue. Nothing is unlocked here: `downloadEnabled` and the licence itself
   * remain the owner's decision, so a customer can submit as often as they
   * like without gaining anything by doing so.
   */
  async requestActivation(
    customerId: number,
    input: {
      planId: number;
      amount: number;
      notes?: string;
      receipt: { url: string; size: number };
      subscriptionId?: number;
    },
    req: Request,
  ) {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
    });

    if (customer.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended. Please contact support.');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: input.planId },
      select: { id: true, key: true, name: true, status: true },
    });
    if (!plan || plan.status !== 'ACTIVE') {
      throw new BadRequestException('The selected plan is not available.');
    }

    const payment = await this.prisma.payment.create({
      data: {
        customerId,
        subscriptionId: input.subscriptionId ?? null,
        amount: input.amount,
        currency: 'EGP',
        method: 'BANK_TRANSFER',
        status: 'PENDING',
        notes: input.notes?.trim() || null,
        receiptUrl: input.receipt.url,
        // A per-customer prefix, so the owner can tell whose receipt is whose
        // while several are open at once, without opening each image.
        transactionReference: `PORTAL-${customerId}-${Date.now()}`,
      },
    });

    await this.recordAudit(req, customerId, 'ACTIVATION_REQUESTED');
    this.logger.log(
      `Activation requested by customer ${customerId} for plan ${plan.key} (payment ${payment.id})`,
    );

    return {
      id: payment.id,
      status: payment.status,
      plan,
      message: 'تم إرسال طلبك. سنتواصل معك بعد مراجعة الحوالة.',
    };
  }

  /** The customer's own activation requests, so they can track progress. */
  async myRequests(customerId: number) {
    const payments = await this.prisma.payment.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        receiptUrl: true,
        transactionReference: true,
        createdAt: true,
        verifiedAt: true,
      },
    });
    return { data: payments };
  }


  /**
   * Resolves one of this customer's own receipts.
   *
   * The stored `receiptUrl` is a bare `/receipts/<uuid>.png`, which is the
   * owner's route and is deliberately admin-only. Rather than loosening that
   * guard, ownership is proven here by loading the payment and checking its
   * `customerId` — so a customer can read the receipt they uploaded and
   * nothing else. The lookup is scoped in the query rather than filtered after
   * it, so a foreign id returns 404 and never reveals that it exists.
   */
  async ownReceipt(customerId: number, paymentId: number) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, customerId },
      select: { id: true, receiptUrl: true },
    });

    if (!payment?.receiptUrl) {
      throw new NotFoundException('لا توجد حوالة لهذا الطلب.');
    }

    // Stored as `<prefix>/<uuid>.<ext>`; the storage service re-validates the
    // filename, so anything unexpected here is refused at the read.
    const name = payment.receiptUrl.split('/').pop() ?? '';
    if (!name) throw new NotFoundException('لا توجد حوالة لهذا الطلب.');

    return { name, paymentId: payment.id };
  }


  // ------------------------------------------------------------- internals

  private async recordAudit(req: Request, customerId: number, action: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          entity: 'CUSTOMER',
          entityId: String(customerId),
          action,
          ip:
            (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
        },
      });
    } catch {
      // Auditing must never block a sign-in.
    }
  }
}

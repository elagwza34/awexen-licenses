import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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

  async login(dto: CustomerLoginDto, req: Request) {
    const email = dto.email.trim().toLowerCase();
    const customer = await this.prisma.customer.findUnique({ where: { email } });

    const ok = await this.security.verifyPassword(
      dto.password,
      customer?.passwordHash ?? DUMMY_HASH,
    );

    if (!customer || !customer.passwordHash || !ok) {
      this.logger.warn(`Failed portal sign-in for ${email}`);
      throw new UnauthorizedException('Incorrect email or password.');
    }
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

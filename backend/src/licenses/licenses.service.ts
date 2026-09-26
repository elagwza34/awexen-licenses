import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivationType,
  AuditEntity,
  BillingInterval,
  DeviceStatus,
  LicenseStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { addDays, addMonths, addYears } from 'date-fns';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { LicenseCryptoService } from '../common/crypto/license-crypto.service';
import { SecurityService } from '../common/crypto/security.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  ChangeLicensePlanDto,
  CreateLicenseDto,
  ExpiryFilter,
  ExtendLicenseDto,
  RenewLicenseDto,
  ResetDeviceDto,
  UpdateLicenseDto,
} from './dto/license.dto';
import { generateLicenseKey, normalizeLicenseKey } from './license-key.util';
import { LicenseStatusService } from './license-status.service';

/** Whitelist of sortable columns. Never interpolate user input into orderBy. */
const SORTABLE = new Set(['createdAt', 'expiresAt', 'status', 'licenseKey', 'updatedAt']);

@Injectable()
export class LicensesService {
  private readonly logger = new Logger(LicensesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: LicenseCryptoService,
    private readonly security: SecurityService,
    private readonly config: ConfigService,
    private readonly statusService: LicenseStatusService,
  ) {}

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  async findAll(query: PaginationQueryDto & Record<string, any>): Promise<PaginatedResponse<any>> {
    const where = this.buildWhere(query);

    const [total, rows] = await Promise.all([
      this.prisma.license.count({ where }),
      this.prisma.license.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: this.buildOrderBy(query),
        include: {
          customer: { select: { id: true, name: true, company: true, email: true } },
          plan: { select: { id: true, name: true, nameAr: true, key: true } },
          subscription: { select: { id: true, status: true, expiresAt: true } },
          _count: { select: { devices: { where: { status: DeviceStatus.ACTIVE } } } },
        },
      }),
    ]);

    const data = rows.map((row) => ({
      ...row,
      daysRemaining: this.statusService.daysRemaining(row.expiresAt),
      activeDevices: row._count.devices,
      derivedStatus: this.statusService.derive(row).status,
    }));

    return paginated(data, total, query.page, query.limit);
  }

  async findOne(id: number) {
    const license = await this.prisma.license.findUnique({
      where: { id },
      include: {
        customer: true,
        plan: { include: { features: { include: { feature: true } } } },
        subscription: true,
        devices: { orderBy: { lastSeenAt: 'desc' } },
      },
    });

    if (!license) throw new NotFoundException('License not found');

    const derived = this.statusService.derive(license);
    const activeDevices = license.devices.filter((d) => d.status === DeviceStatus.ACTIVE).length;

    return {
      ...license,
      // Never leak the signature or raw payload hash to the panel UI.
      signature: undefined,
      payloadHash: undefined,
      derivedStatus: derived.status,
      statusReason: derived.reason,
      daysRemaining: this.statusService.daysRemaining(license.expiresAt),
      activeDevices,
      deviceSlotsFree: Math.max(0, license.maxDevices - activeDevices),
      features: license.plan.features.map((pf) => pf.feature.key),
    };
  }

  async findByKey(key: string) {
    const license = await this.prisma.license.findUnique({
      where: { licenseKey: normalizeLicenseKey(key) },
      include: { customer: true, plan: { include: { features: { include: { feature: true } } } } },
    });
    if (!license) throw new NotFoundException('License not found');
    return { ...license, daysRemaining: this.statusService.daysRemaining(license.expiresAt) };
  }

  /** Signed payload the customer application consumes. Public key is safe to embed. */
  async getSignedPayload(id: number) {
    const license = await this.prisma.license.findUniqueOrThrow({
      where: { id },
      include: { plan: { include: { features: { include: { feature: true } } } } },
    });

    const payload = {
      licenseKey: license.licenseKey,
      planKey: license.plan.key,
      edition: license.plan.name,
      features: license.plan.features.map((pf) => pf.feature.key).sort(),
      maxDevices: license.maxDevices,
      issuedAt: license.createdAt.toISOString(),
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      version: license.version,
    };

    const signed = this.crypto.sign(payload);
    return {
      payload,
      signature: signed.signature,
      payloadHash: signed.payloadHash,
      publicKey: this.crypto.getPublicKeyPem(),
    };
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async create(dto: CreateLicenseDto, actor: AuditActor, req: any) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer || customer.deletedAt) throw new NotFoundException('Customer not found');

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    let subscriptionId = dto.subscriptionId ?? null;
    if (!subscriptionId) {
      const active = await this.prisma.subscription.findFirst({
        where: { customerId: dto.customerId, planId: dto.planId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] } },
        orderBy: { createdAt: 'desc' },
      });
      subscriptionId = active?.id ?? null;
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    // Default the expiry from the plan billing interval so the dates are
    // consistent by construction (no hand-edited, mismatched dates).
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : this.addInterval(startsAt, plan.billingInterval);
    const maxDevices = dto.maxDevices ?? plan.maxDevices;
    const isTrial = dto.isTrial ?? plan.isTrialPlan;

    const license = await this.prisma.$transaction(async (tx) => {
      const created = await tx.license.create({
        data: {
          licenseKey: await this.generateUniqueKey(),
          customerId: dto.customerId,
          subscriptionId,
          planId: dto.planId,
          status: isTrial ? LicenseStatus.TRIAL : LicenseStatus.ACTIVE,
          startsAt,
          expiresAt,
          maxDevices,
          isTrial,
          notes: dto.notes,
          reissueOfId: dto.reissueOfId,
        },
        include: { customer: true, plan: true },
      });

      await this.audit.record(
        {
          action: 'license.created',
          entity: AuditEntity.LICENSE,
          entityId: created.id,
          newValue: {
            licenseKey: created.licenseKey,
            customerId: created.customerId,
            planId: created.planId,
            status: created.status,
            startsAt: created.startsAt,
            expiresAt: created.expiresAt,
            maxDevices: created.maxDevices,
            isTrial: created.isTrial,
          },
          metadata: { reissueOfId: dto.reissueOfId },
          tx,
        },
        actor,
        req,
      );

      return created;
    });

    // Sign after commit so the payload reflects the persisted row.
    await this.resign(license.id);
    return this.findOne(license.id);
  }

  async update(id: number, dto: UpdateLicenseDto, actor: AuditActor, req: any) {
    const existing = await this.prisma.license.findUniqueOrThrow({ where: { id } });

    if (dto.planId && dto.planId !== existing.planId) {
      throw new ConflictException('Use the change-plan action to move a license to another plan');
    }
    if (existing.status === LicenseStatus.REVOKED) {
      throw new ConflictException('A revoked license cannot be edited; issue a replacement instead');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const data: Prisma.LicenseUpdateInput = {};
      if (dto.maxDevices !== undefined) data.maxDevices = dto.maxDevices;
      if (dto.notes !== undefined) data.notes = dto.notes;
      if (dto.startsAt) data.startsAt = new Date(dto.startsAt);
      if (dto.expiresAt) data.expiresAt = new Date(dto.expiresAt);
      if (dto.isTrial !== undefined) data.isTrial = dto.isTrial;
      // Any material change invalidates the client's cached payload.
      data.version = { increment: 1 };

      const result = await tx.license.update({ where: { id }, data });
      await this.audit.record(
        { action: 'license.updated', entity: AuditEntity.LICENSE, entityId: id, oldValue: existing, newValue: result, tx },
        actor,
        req,
      );
      return result;
    });

    await this.resign(id);
    return this.findOne(updated.id);
  }

  // ------------------------------------------------------------------
  // Renew / Extend
  //
  // Renewal is the trickiest operation in the system: the subscription AND
  // every license bound to it must move together, atomically, or the customer
  // ends up with inconsistent dates (spec rule: "Do not create inconsistent
  // subscription/license dates").
  // ------------------------------------------------------------------

  async renew(id: number, dto: RenewLicenseDto, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({
      where: { id },
      include: { subscription: true, plan: true },
    });

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('A revoked license cannot be renewed. Issue a replacement license.');
    }

    const interval = dto.billingInterval ?? license.subscription?.billingInterval ?? license.plan.billingInterval;
    const periods = dto.periods ?? 1;

    // Anchor: today or the current expiry, whichever is later. Renewing early
    // must never shorten the customer's paid-for period.
    const now = new Date();
    const anchor =
      license.expiresAt && license.expiresAt > now ? license.expiresAt : now;

    const newExpiry = dto.expiresAt
      ? new Date(dto.expiresAt)
      : this.addInterval(anchor, interval, periods);

    if (newExpiry <= now) {
      throw new BadRequestException('The new expiry date must be in the future');
    }

    const newStatus = license.isTrial ? LicenseStatus.ACTIVE : LicenseStatus.ACTIVE;

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedLicense = await tx.license.update({
        where: { id },
        data: {
          expiresAt: newExpiry,
          status: newStatus,
          isTrial: false,
          version: { increment: 1 },
        },
      });

      // Keep the subscription in lockstep. A paid renewal converts TRIAL to
      // ACTIVE and never shortens its expiry either.
      let updatedSubscription = null;
      if (license.subscriptionId) {
        updatedSubscription = await tx.subscription.update({
          where: { id: license.subscriptionId },
          data: {
            expiresAt: newExpiry,
            billingInterval: interval,
            status:
              license.subscription?.status === SubscriptionStatus.TRIAL ||
              license.subscription?.status === SubscriptionStatus.EXPIRED ||
              license.subscription?.status === SubscriptionStatus.PAST_DUE
                ? SubscriptionStatus.ACTIVE
                : license.subscription?.status,
            endedAt: null,
          },
        });
      }

      // Any sibling licenses on the same subscription must not drift out of
      // sync with it.
      if (license.subscriptionId) {
        await tx.license.updateMany({
          where: {
            subscriptionId: license.subscriptionId,
            id: { not: id },
            status: { notIn: [LicenseStatus.REVOKED, LicenseStatus.SUSPENDED] },
          },
          data: { expiresAt: newExpiry, version: { increment: 1 } },
        });
      }

      await this.audit.record(
        {
          action: 'license.renewed',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { expiresAt: license.expiresAt, status: license.status },
          newValue: { expiresAt: newExpiry, status: newStatus },
          metadata: { interval, periods, reason: dto.reason, subscriptionId: license.subscriptionId },
          tx,
        },
        actor,
        req,
      );

      return updatedLicense;
    });

    // Re-sign every license that shares the subscription.
    await this.resignSubscriptionLicenses(license.subscriptionId);
    return this.findOne(result.id);
  }

  async extend(id: number, dto: ExtendLicenseDto, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id } });
    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('A revoked license cannot be extended');
    }

    const now = new Date();
    const anchor = license.expiresAt && license.expiresAt > now ? license.expiresAt : now;
    const newExpiry = addDays(anchor, dto.days);

    await this.prisma.$transaction(async (tx) => {
      await tx.license.update({
        where: { id },
        data: { expiresAt: newExpiry, version: { increment: 1 } },
      });

      if (license.subscriptionId) {
        await tx.subscription.update({
          where: { id: license.subscriptionId },
          data: { expiresAt: newExpiry },
        });
        await tx.license.updateMany({
          where: { subscriptionId: license.subscriptionId, id: { not: id } },
          data: { expiresAt: newExpiry, version: { increment: 1 } },
        });
      }

      await this.audit.record(
        {
          action: 'license.extended',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { expiresAt: license.expiresAt },
          newValue: { expiresAt: newExpiry },
          metadata: { days: dto.days, reason: dto.reason },
          tx,
        },
        actor,
        req,
      );
    });

    await this.resignSubscriptionLicenses(license.subscriptionId);
    return this.findOne(id);
  }

  // ------------------------------------------------------------------
  // Suspend / Reactivate / Revoke
  //
  // Business rules 2 & 3:
  //   * suspended licenses stay in history and are always reversible
  //   * REVOKED is terminal — it can never be reactivated, only replaced
  // ------------------------------------------------------------------

  async suspend(id: number, reason: string | undefined, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id } });

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('A revoked license cannot be suspended');
    }
    if (license.status === LicenseStatus.SUSPENDED) {
      throw new ConflictException('License is already suspended');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.license.update({
        where: { id },
        data: {
          status: LicenseStatus.SUSPENDED,
          suspendedAt: new Date(),
          suspendedReason: reason ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          action: 'license.suspended',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { status: license.status },
          newValue: { status: LicenseStatus.SUSPENDED, reason },
          tx,
        },
        actor,
        req,
      );
    });

    await this.resign(id);
    return this.findOne(id);
  }

  async reactivate(id: number, reason: string | undefined, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id } });

    // Rule 3 — a revoked key is permanently dead. Reactivation must fail loudly.
    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException(
        'A revoked license cannot be reactivated. Issue a replacement license linked to the original.',
      );
    }
    if (license.status !== LicenseStatus.SUSPENDED) {
      throw new ConflictException('Only a suspended license can be reactivated');
    }

    // Reactivate into the state the license would naturally be in now, rather
    // than blindly setting ACTIVE (which could resurrect an expired license).
    const derived = this.statusService.derive({
      ...license,
      status: LicenseStatus.ACTIVE,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.license.update({
        where: { id },
        data: {
          status: derived.status,
          suspendedAt: null,
          suspendedReason: null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(
        {
          action: 'license.reactivated',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { status: license.status, suspendedReason: license.suspendedReason },
          newValue: { status: derived.status, reason },
          tx,
        },
        actor,
        req,
      );
    });

    await this.resign(id);
    return this.findOne(id);
  }

  async revoke(id: number, reason: string | undefined, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id } });

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('License is already revoked');
    }

    await this.prisma.$transaction(async (tx) => {
      // Revoking a key must also kill every device and the binding subscription,
      // otherwise the customer app would keep validating via a sibling licence.
      await tx.license.update({
        where: { id },
        data: {
          status: LicenseStatus.REVOKED,
          revokedAt: new Date(),
          revokedReason: reason ?? null,
          suspendedAt: null,
          suspendedReason: null,
          version: { increment: 1 },
        },
      });

      await tx.device.updateMany({
        where: { licenseId: id, status: { not: DeviceStatus.REVOKED } },
        data: { status: DeviceStatus.REVOKED, revokedAt: new Date() },
      });

      if (license.subscriptionId) {
        await tx.subscription.update({
          where: { id: license.subscriptionId },
          data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date(), endedAt: new Date() },
        });
      }

      await this.audit.record(
        {
          action: 'license.revoked',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { status: license.status, licenseKey: license.licenseKey },
          newValue: { status: LicenseStatus.REVOKED, reason },
          metadata: { devicesRevoked: true, subscriptionCancelled: Boolean(license.subscriptionId) },
          tx,
        },
        actor,
        req,
      );
    });

    await this.resign(id);
    return this.findOne(id);
  }

  // ------------------------------------------------------------------
  // Plan change (upgrade / downgrade)
  //
  // We do NOT invent proration. The proration mode is read from the
  // subscription/settings and the admin confirms the resulting charge
  // explicitly. Changing the plan never shortens the paid period.
  // ------------------------------------------------------------------

  async changePlan(id: number, dto: ChangeLicensePlanDto, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });

    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('A revoked license cannot change plan');
    }

    const newPlan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!newPlan) throw new NotFoundException('Target plan not found');
    if (newPlan.id === license.planId) {
      throw new BadRequestException('The license is already on this plan');
    }

    const prorationMode = license.subscription?.prorationMode ?? 'NONE';

    // A downgrade must not silently drop device slots below what is already in
    // use — the admin must free devices first.
    if (newPlan.maxDevices < license.maxDevices) {
      const activeDevices = await this.prisma.device.count({
        where: { licenseId: id, status: DeviceStatus.ACTIVE },
      });
      if (activeDevices > newPlan.maxDevices) {
        throw new ConflictException(
          `Cannot downgrade: the license has ${activeDevices} active device(s) but the new plan allows ${newPlan.maxDevices}. Reset devices first.`,
        );
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Upgrades widen the allowance; downgrades narrow it (validated above to
      // not conflict with devices already in use).
      const updated = await tx.license.update({
        where: { id },
        data: {
          planId: newPlan.id,
          maxDevices: newPlan.maxDevices,
          version: { increment: 1 },
        },
      });

      if (license.subscriptionId && dto.applyImmediately !== false) {
        await tx.subscription.update({
          where: { id: license.subscriptionId },
          data: {
            planId: newPlan.id,
            price: newPlan.price,
            currency: newPlan.currency,
            billingInterval: newPlan.billingInterval,
          },
        });
      }

      await this.audit.record(
        {
          action: 'license.plan_changed',
          entity: AuditEntity.LICENSE,
          entityId: id,
          oldValue: { planId: license.planId, maxDevices: license.maxDevices },
          newValue: { planId: newPlan.id, maxDevices: updated.maxDevices, planKey: newPlan.key },
          metadata: {
            prorationMode,
            applyImmediately: dto.applyImmediately !== false,
            reason: dto.reason,
            note: 'Proration is not computed automatically; confirm the charge manually.',
          },
          tx,
        },
        actor,
        req,
      );

      return updated;
    });

    await this.resign(id);
    return this.findOne(result.id);
  }

  // ------------------------------------------------------------------
  // Device reset (must be logged — business rule 4)
  // ------------------------------------------------------------------

  async resetDevice(licenseId: number, dto: ResetDeviceDto, actor: AuditActor, req: any) {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id: licenseId } });
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });

    if (!device || device.licenseId !== licenseId) {
      throw new NotFoundException('Device not found for this license');
    }
    if (license.status === LicenseStatus.REVOKED) {
      throw new ConflictException('Devices cannot be reset on a revoked license');
    }

    await this.prisma.$transaction(async (tx) => {
      // Revoke rather than delete: the activation history must remain intact.
      await tx.device.update({
        where: { id: device.id },
        data: { status: DeviceStatus.REVOKED, revokedAt: new Date(), blockedReason: dto.reason ?? 'Reset by administrator' },
      });

      await tx.activation.create({
        data: {
          licenseId,
          deviceId: device.id,
          customerId: license.customerId,
          activationType: ActivationType.DEVICE_RESET,
          success: true,
          performedById: actor.id,
          note: dto.reason ?? 'Device slot released by administrator',
        },
      });

      await this.audit.record(
        {
          action: 'license.device_reset',
          entity: AuditEntity.DEVICE,
          entityId: device.id,
          oldValue: { status: device.status, deviceName: device.deviceName },
          newValue: { status: DeviceStatus.REVOKED },
          metadata: { licenseId, licenseKey: license.licenseKey, reason: dto.reason },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(licenseId);
  }

  // ------------------------------------------------------------------
  // Expiration monitoring
  // ------------------------------------------------------------------

  async findExpiring(filter: ExpiryFilter) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 86_400_000 - 1);

    let where: Prisma.LicenseWhereInput;
    switch (filter) {
      case ExpiryFilter.TODAY:
        where = { expiresAt: { gte: startOfToday, lte: endOfToday } };
        break;
      case ExpiryFilter.SEVEN_DAYS:
        where = { expiresAt: { gte: now, lte: addDays(now, 7) } };
        break;
      case ExpiryFilter.THIRTY_DAYS:
        where = { expiresAt: { gte: now, lte: addDays(now, 30) } };
        break;
      case ExpiryFilter.EXPIRED:
        where = { expiresAt: { lt: now }, status: { in: [LicenseStatus.EXPIRED, LicenseStatus.EXPIRING] } };
        break;
      case ExpiryFilter.GRACE:
        where = { expiresAt: { lt: now, gte: addDays(now, -30) } };
        break;
      default:
        where = {};
    }

    const rows = await this.prisma.license.findMany({
      where,
      orderBy: { expiresAt: 'asc' },
      take: 200,
      include: {
        customer: { select: { id: true, name: true, company: true, email: true, phone: true } },
        plan: { select: { id: true, name: true, nameAr: true } },
        subscription: {
          select: { id: true, status: true, payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, paidAt: true, amount: true } } },
        },
        _count: { select: { devices: { where: { status: DeviceStatus.ACTIVE } } } },
      },
    });

    return {
      data: rows.map((row) => ({
        ...row,
        daysRemaining: this.statusService.daysRemaining(row.expiresAt),
        activeDevices: row._count.devices,
      })),
      meta: { filter, count: rows.length, generatedAt: now },
    };
  }

  // ------------------------------------------------------------------
  // History
  // ------------------------------------------------------------------

  async history(id: number, take = 50) {
    const [activations, validations, auditLogs] = await Promise.all([
      this.prisma.activation.findMany({
        where: { licenseId: id },
        orderBy: { createdAt: 'desc' },
        take,
        include: { device: { select: { id: true, deviceName: true } } },
      }),
      this.prisma.licenseValidation.findMany({
        where: { licenseId: id },
        orderBy: { createdAt: 'desc' },
        take,
        include: { device: { select: { id: true, deviceName: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { entity: AuditEntity.LICENSE, entityId: String(id) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);
    return { activations, validations, auditLogs };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private buildWhere(query: Record<string, any>): Prisma.LicenseWhereInput {
    const where: Prisma.LicenseWhereInput = {};
    const and: Prisma.LicenseWhereInput[] = [];

    if (query.status) {
      const statuses = String(query.status).split(',').map((s) => s.trim().toUpperCase());
      const valid = statuses.filter((s) => Object.values(LicenseStatus).includes(s as LicenseStatus));
      if (valid.length) where.status = { in: valid as LicenseStatus[] };
    }
    if (query.customerId) where.customerId = Number(query.customerId);
    if (query.planId) where.planId = Number(query.planId);
    if (query.subscriptionId) where.subscriptionId = Number(query.subscriptionId);
    if (query.isTrial !== undefined) where.isTrial = query.isTrial === 'true' || query.isTrial === true;

    if (query.search) {
      and.push({
        OR: [
          { licenseKey: { contains: String(query.search).toUpperCase(), mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
          { customer: { company: { contains: query.search, mode: 'insensitive' } } },
          { customer: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }

    if (query.expiresBefore) {
      and.push({ expiresAt: { lte: new Date(query.expiresBefore) } });
    }
    if (query.expiresAfter) {
      and.push({ expiresAt: { gte: new Date(query.expiresAfter) } });
    }

    if (and.length) where.AND = and;
    return where;
  }

  private buildOrderBy(query: Record<string, any>): Prisma.LicenseOrderByWithRelationInput {
    const field = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'createdAt';
    return { [field]: query.sortOrder === 'asc' ? 'asc' : 'desc' } as Prisma.LicenseOrderByWithRelationInput;
  }

  /**
   * Adds N billing intervals to a date. QUARTERLY is 3 months (not 90 days) so
   * calendar dates stay predictable for the customer.
   */
  private addInterval(from: Date, interval: BillingInterval, periods = 1): Date {
    switch (interval) {
      case BillingInterval.MONTHLY:
        return addMonths(from, periods);
      case BillingInterval.QUARTERLY:
        return addMonths(from, 3 * periods);
      case BillingInterval.YEARLY:
        return addYears(from, periods);
      case BillingInterval.LIFETIME:
        return new Date('2999-12-31T23:59:59.000Z');
      default:
        return addMonths(from, periods);
    }
  }

  /** Collision-resistant key generation with a DB uniqueness guarantee. */
  private async generateUniqueKey(): Promise<string> {
    const prefix = this.config.get<string>('LICENSE_KEY_PREFIX', 'PROD');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = generateLicenseKey(prefix);
      const exists = await this.prisma.license.findUnique({ where: { licenseKey: key }, select: { id: true } });
      if (!exists) return key;
    }
    throw new ConflictException('Could not generate a unique license key. Please retry.');
  }

  /** Recomputes and stores the signature for a license. */
  private async resign(licenseId: number): Promise<void> {
    try {
      const license = await this.prisma.license.findUniqueOrThrow({
        where: { id: licenseId },
        include: { plan: { include: { features: { include: { feature: true } } } } },
      });

      const { signature, payloadHash } = this.crypto.sign({
        licenseKey: license.licenseKey,
        planKey: license.plan.key,
        edition: license.plan.name,
        features: license.plan.features.map((pf) => pf.feature.key).sort(),
        maxDevices: license.maxDevices,
        issuedAt: license.createdAt.toISOString(),
        expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
        version: license.version,
      });

      await this.prisma.license.update({
        where: { id: licenseId },
        data: { signature, payloadHash },
      });
    } catch (error) {
      // A signing failure must not silently leave an unsigned license active.
      this.logger.error(`Failed to sign license ${licenseId}`, error);
      throw new ForbiddenException('Could not sign the license payload. Check the signing key configuration.');
    }
  }

  private async resignSubscriptionLicenses(subscriptionId: number | null): Promise<void> {
    if (!subscriptionId) return;
    const licenses = await this.prisma.license.findMany({
      where: { subscriptionId },
      select: { id: true },
    });
    for (const license of licenses) {
      await this.resign(license.id);
    }
  }
}







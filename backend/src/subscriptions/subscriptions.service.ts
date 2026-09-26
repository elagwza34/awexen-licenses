import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEntity, BillingInterval, Prisma, SubscriptionStatus } from '@prisma/client';
import { addDays, addMonths, addYears } from 'date-fns';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CancelSubscriptionDto,
  ChangeSubscriptionPlanDto,
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
  RenewSubscriptionDto,
  SubscriptionActionDto,
} from './dto/subscription.dto';

const SORTABLE = new Set(['createdAt', 'expiresAt', 'status', 'startsAt', 'updatedAt']);

/** Statuses a customer may never be moved back into by hand. */
const TERMINAL: SubscriptionStatus[] = [SubscriptionStatus.CANCELLED];

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  async findAll(
    query: PaginationQueryDto & ListSubscriptionsQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const where: Prisma.SubscriptionWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.planId) where.planId = query.planId;

    if (query.search) {
      where.OR = [
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { company: { contains: query.search, mode: 'insensitive' } } },
        { customer: { email: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    if (query.expiresBefore) where.expiresAt = { lte: new Date(query.expiresBefore) };
    if (query.expiresAfter) where.expiresAt = { gte: new Date(query.expiresAfter) };

    const [total, rows] = await Promise.all([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: this.buildOrderBy(query),
        include: {
          customer: { select: { id: true, name: true, company: true, email: true } },
          plan: { select: { id: true, name: true, nameAr: true, key: true, maxDevices: true } },
          _count: { select: { licenses: true, payments: true } },
        },
      }),
    ]);

    return paginated(
      rows.map((row) => ({ ...row, daysRemaining: this.daysRemaining(row.expiresAt) })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: number) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        customer: true,
        plan: { include: { features: { include: { feature: true } } } },
        licenses: {
          select: {
            id: true, licenseKey: true, status: true, expiresAt: true, maxDevices: true,
          },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 50 },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 50 },
      },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');

    return {
      ...subscription,
      daysRemaining: this.daysRemaining(subscription.expiresAt),
      featureKeys: subscription.plan.features.map((pf) => pf.feature.key),
    };
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async create(dto: CreateSubscriptionDto, actor: AuditActor, req: Request) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException('Subscriptions cannot be created against an archived plan');
    }

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const interval = dto.billingInterval ?? plan.billingInterval;

    // An explicit expiry wins; otherwise derive it from the interval so dates
    // are never hand-typed and cannot disagree.
    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : this.addInterval(startsAt, interval);

    const price = dto.price ?? plan.price;
    const isTrial = plan.isTrialPlan;
    const trialDays = plan.trialDays;

    // A trial subscription is TRIAL and expires after the trial window.
    const trialEndsAt = isTrial && trialDays > 0 ? addDays(startsAt, trialDays) : null;
    const status = isTrial ? SubscriptionStatus.TRIAL : SubscriptionStatus.ACTIVE;

    const subscription = await this.prisma.$transaction(async (tx) => {
      const created = await tx.subscription.create({
        data: {
          customerId: dto.customerId,
          planId: dto.planId,
          status,
          price,
          currency: dto.currency ?? plan.currency,
          billingInterval: interval,
          autoRenew: dto.autoRenew ?? true,
          startsAt,
          expiresAt: isTrial && trialEndsAt ? trialEndsAt : expiresAt,
          trialEndsAt,
        },
        include: { plan: true, customer: true },
      });

      await this.audit.record(
        {
          action: 'subscription.created',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: created.id,
          newValue: {
            customerId: created.customerId,
            planId: created.planId,
            status: created.status,
            startsAt: created.startsAt,
            expiresAt: created.expiresAt,
            price: created.price,
          },
          tx,
        },
        actor,
        req,
      );

      return created;
    });

    return this.findOne(subscription.id);
  }

  async update(id: number, dto: any, actor: AuditActor, req: Request) {
    const existing = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });

    if (TERMINAL.includes(existing.status) && dto.status && dto.status !== existing.status) {
      throw new ConflictException('A cancelled subscription cannot change status');
    }
    if (dto.planId && dto.planId !== existing.planId) {
      throw new ConflictException('Use the change-plan action to move a subscription');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id },
        data: {
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.currency !== undefined ? { currency: dto.currency } : {}),
          ...(dto.billingInterval !== undefined ? { billingInterval: dto.billingInterval } : {}),
          ...(dto.autoRenew !== undefined ? { autoRenew: dto.autoRenew } : {}),
          ...(dto.startsAt ? { startsAt: new Date(dto.startsAt) } : {}),
          ...(dto.expiresAt ? { expiresAt: new Date(dto.expiresAt) } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });

      await this.audit.record(
        {
          action: 'subscription.updated',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: existing,
          newValue: result,
          metadata: { changed: Object.keys(dto) },
          tx,
        },
        actor,
        req,
      );

      return result;
    });

    return this.findOne(updated.id);
  }

  // ------------------------------------------------------------------
  // Lifecycle
  //
  // Every state change also moves the bound licences in the same
  // transaction, so a subscription and its licences can never disagree.
  // ------------------------------------------------------------------

  async renew(id: number, dto: RenewSubscriptionDto, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });

    if (TERMINAL.includes(subscription.status)) {
      throw new ConflictException('A cancelled subscription cannot be renewed');
    }

    const interval = dto.billingInterval ?? subscription.billingInterval;
    const periods = dto.periods ?? 1;
    const now = new Date();

    // Anchor on the paid-through date so renewing early never loses time.
    const anchor =
      subscription.expiresAt && subscription.expiresAt > now ? subscription.expiresAt : now;
    const newExpiry = dto.expiresAt
      ? new Date(dto.expiresAt)
      : this.addInterval(anchor, interval, periods);

    if (newExpiry <= now) {
      throw new BadRequestException('The new expiry date must be in the future');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: {
          expiresAt: newExpiry,
          billingInterval: interval,
          status: SubscriptionStatus.ACTIVE,
          endedAt: null,
        },
      });

      // Every licence on this subscription must agree with it.
      await tx.license.updateMany({
        where: { subscriptionId: id, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
        data: { expiresAt: newExpiry, version: { increment: 1 } },
      });

      await this.audit.record(
        {
          action: 'subscription.renewed',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { expiresAt: subscription.expiresAt, status: subscription.status },
          newValue: { expiresAt: newExpiry, status: SubscriptionStatus.ACTIVE },
          metadata: { interval, periods, reason: dto.reason },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  async extend(id: number, days: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });
    const now = new Date();
    const anchor =
      subscription.expiresAt && subscription.expiresAt > now ? subscription.expiresAt : now;
    const newExpiry = addDays(anchor, days);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { expiresAt: newExpiry } });
      await tx.license.updateMany({
        where: { subscriptionId: id, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
        data: { expiresAt: newExpiry, version: { increment: 1 } },
      });
      await this.audit.record(
        {
          action: 'subscription.extended',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { expiresAt: subscription.expiresAt },
          newValue: { expiresAt: newExpiry },
          metadata: { days, reason },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  async suspend(id: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });

    if (TERMINAL.includes(subscription.status)) {
      throw new ConflictException('A cancelled subscription cannot be suspended');
    }
    if (subscription.status === SubscriptionStatus.SUSPENDED) {
      throw new ConflictException('Subscription is already suspended');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status: SubscriptionStatus.SUSPENDED } });

      // A suspended subscription must stop its licences working immediately.
      await tx.license.updateMany({
        where: { subscriptionId: id, status: { in: ['ACTIVE', 'TRIAL', 'EXPIRING'] } },
        data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: reason ?? null },
      });

      await this.audit.record(
        {
          action: 'subscription.suspended',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { status: subscription.status },
          newValue: { status: SubscriptionStatus.SUSPENDED, reason },
          metadata: { licencesAffected: true },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  /**
   * Reactivate into the state the period actually implies rather than forcing
   * ACTIVE — a period that already ended must come back EXPIRED.
   */
  async reactivate(id: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });

    if (TERMINAL.includes(subscription.status)) {
      throw new ConflictException('A cancelled subscription cannot be reactivated');
    }
    if (subscription.status !== SubscriptionStatus.SUSPENDED) {
      throw new ConflictException('Only a suspended subscription can be reactivated');
    }

    const now = new Date();
    const restored =
      subscription.expiresAt && subscription.expiresAt <= now
        ? SubscriptionStatus.EXPIRED
        : SubscriptionStatus.ACTIVE;

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id }, data: { status: restored, endedAt: null } });

      // Licences follow the subscription; REVOKED stays terminal.
      await tx.license.updateMany({
        where: { subscriptionId: id, status: 'SUSPENDED' },
        data: { status: restored, suspendedAt: null, suspendedReason: null },
      });

      await this.audit.record(
        {
          action: 'subscription.reactivated',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { status: subscription.status },
          newValue: { status: restored, reason },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  async cancel(id: number, dto: CancelSubscriptionDto, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({ where: { id } });

    if (TERMINAL.includes(subscription.status)) {
      throw new ConflictException('Subscription is already cancelled');
    }

    const now = new Date();
    // atPeriodEnd keeps the customer paid for the remainder of the period.
    const effectiveEnd = dto.atPeriodEnd && subscription.expiresAt ? subscription.expiresAt : now;

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: {
          status: SubscriptionStatus.CANCELLED,
          cancelledAt: now,
          cancelReason: dto.reason ?? null,
          endedAt: effectiveEnd,
          autoRenew: false,
        },
      });

      await tx.license.updateMany({
        where: { subscriptionId: id, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
        data: { status: 'EXPIRED' },
      });

      await this.audit.record(
        {
          action: 'subscription.cancelled',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { status: subscription.status, autoRenew: subscription.autoRenew },
          newValue: { status: SubscriptionStatus.CANCELLED, atPeriodEnd: dto.atPeriodEnd },
          metadata: { reason: dto.reason, effectiveEnd },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  /**
   * Change plan on a live subscription.
   *
   * Proration is deliberately NOT computed. The mode is read from the
   * subscription, recorded in the audit trail, and the admin settles the money
   * manually — inventing a formula here would be a business decision, not a
   * technical one.
   */
  async changePlan(id: number, dto: ChangeSubscriptionPlanDto, actor: AuditActor, req: Request) {
    const subscription = await this.prisma.subscription.findUniqueOrThrow({
      where: { id },
      include: { plan: true },
    });

    if (TERMINAL.includes(subscription.status)) {
      throw new ConflictException('A cancelled subscription cannot change plan');
    }

    const newPlan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!newPlan) throw new NotFoundException('Target plan not found');
    if (newPlan.id === subscription.planId) {
      throw new BadRequestException('The subscription is already on this plan');
    }

    // A downgrade must not strand devices above the new plan's limit.
    if (newPlan.maxDevices < subscription.plan.maxDevices) {
      const active = await this.prisma.device.count({
        where: { license: { subscriptionId: id }, status: 'ACTIVE' },
      });
      if (active > newPlan.maxDevices) {
        throw new ConflictException(
          `Cannot downgrade: ${active} active device(s) exceed the new plan's limit of ${newPlan.maxDevices}. Reset devices first.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id },
        data: {
          planId: newPlan.id,
          price: newPlan.price,
          currency: newPlan.currency,
          billingInterval: newPlan.billingInterval,
        },
      });

      if (dto.applyImmediately !== false) {
        await tx.license.updateMany({
          where: { subscriptionId: id, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
          data: { planId: newPlan.id, maxDevices: newPlan.maxDevices, version: { increment: 1 } },
        });
      }

      await this.audit.record(
        {
          action: 'subscription.plan_changed',
          entity: AuditEntity.SUBSCRIPTION,
          entityId: id,
          oldValue: { planId: subscription.planId, price: subscription.price },
          newValue: { planId: newPlan.id, price: newPlan.price, planKey: newPlan.key },
          metadata: {
            prorationMode: subscription.prorationMode,
            applyImmediately: dto.applyImmediately !== false,
            reason: dto.reason,
            note: 'Proration is not computed automatically; confirm the charge manually.',
          },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  private buildOrderBy(query: Record<string, any>): Prisma.SubscriptionOrderByWithRelationInput {
    const field = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'createdAt';
    return {
      [field]: query.sortOrder === 'asc' ? 'asc' : 'desc',
    } as Prisma.SubscriptionOrderByWithRelationInput;
  }

  private daysRemaining(expiresAt: Date | null): number | null {
    if (!expiresAt) return null;
    return Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000));
  }

  /** QUARTERLY is 3 calendar months, not 90 days. */
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
}

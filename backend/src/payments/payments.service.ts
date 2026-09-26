import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditEntity, BillingInterval, PaymentStatus, Prisma } from '@prisma/client';
import { addMonths, addYears } from 'date-fns';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  RefundPaymentDto,
  RejectPaymentDto,
  UpdatePaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';

const SORTABLE = new Set(['createdAt', 'paidAt', 'amount', 'status']);

/**
 * Status guards are declared as predicates rather than `[...].includes(...)`:
 * an array literal of enum members narrows to a literal union, which then
 * rejects any other member of the same enum.
 */
const isSettled = (status: PaymentStatus): boolean =>
  status === PaymentStatus.PAID || status === PaymentStatus.REFUNDED;

const isClosed = (status: PaymentStatus): boolean =>
  status === PaymentStatus.REFUNDED || status === PaymentStatus.CANCELLED;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------

  async findAll(
    query: PaginationQueryDto & ListPaymentsQueryDto,
  ): Promise<PaginatedResponse<any> & { totals: { totalAmount: number; refundedAmount: number; count: number } }> {
    const where: Prisma.PaymentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.method) where.method = query.method;
    if (query.customerId) where.customerId = query.customerId;
    if (query.subscriptionId) where.subscriptionId = query.subscriptionId;
    if (query.reference) {
      where.transactionReference = { contains: query.reference, mode: 'insensitive' };
    }
    if (query.search) {
      where.OR = [
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { company: { contains: query.search, mode: 'insensitive' } } },
        { transactionReference: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows, totals] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: this.buildOrderBy(query),
        include: {
          customer: { select: { id: true, name: true, company: true, email: true } },
          subscription: { select: { id: true, plan: { select: { name: true, nameAr: true } } } },
        },
      }),
      // Totals reflect the filtered set, not the whole table.
      this.prisma.payment.aggregate({
        where,
        _sum: { amount: true, refundedAmount: true },
        _count: true,
      }),
    ]);

    return {
      ...paginated(rows, total, query.page, query.limit),
      // Financial totals for the filtered set, carried alongside the page meta.
      totals: {
        totalAmount: totals._sum.amount ?? 0,
        refundedAmount: totals._sum.refundedAmount ?? 0,
        count: totals._count,
      },
    };
  }

  async findOne(id: number) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, company: true, email: true } },
        subscription: { include: { plan: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  /** Revenue summary for the dashboard. */
  async summary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [month, year, pending, failed] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID, paidAt: { gte: startOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID, paidAt: { gte: startOfYear } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PENDING },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.FAILED },
        _count: true,
      }),
    ]);

    return {
      monthRevenue: month._sum.amount ?? 0,
      monthCount: month._count,
      yearRevenue: year._sum.amount ?? 0,
      yearCount: year._count,
      pendingAmount: pending._sum.amount ?? 0,
      pendingCount: pending._count,
      failedCount: failed._count,
    };
  }

  // ------------------------------------------------------------------
  // Create / update
  // ------------------------------------------------------------------

  async create(dto: CreatePaymentDto, actor: AuditActor, req: Request) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    if (dto.subscriptionId) {
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: dto.subscriptionId },
      });
      if (!subscription) throw new NotFoundException('Subscription not found');
      if (subscription.customerId !== dto.customerId) {
        throw new BadRequestException('The subscription does not belong to this customer');
      }
    }

    // The unique index is the real guard; this check just gives a clear message.
    if (dto.transactionReference) {
      const clash = await this.prisma.payment.findUnique({
        where: { transactionReference: dto.transactionReference },
      });
      if (clash) {
        throw new ConflictException('A payment with this transaction reference already exists');
      }
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : null;
    const status = dto.status ?? PaymentStatus.PENDING;

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          customerId: dto.customerId,
          subscriptionId: dto.subscriptionId,
          invoiceId: dto.invoiceId,
          amount: dto.amount,
          currency: dto.currency ?? 'EGP',
          method: dto.method ?? 'BANK_TRANSFER',
          status,
          transactionReference: dto.transactionReference,
          paidAt: status === PaymentStatus.PAID ? paidAt ?? new Date() : paidAt,
          receiptUrl: dto.receiptUrl,
          notes: dto.notes,
        },
      });

      await this.audit.record(
        {
          action: 'payment.created',
          entity: AuditEntity.PAYMENT,
          entityId: created.id,
          newValue: {
            customerId: created.customerId,
            amount: created.amount,
            currency: created.currency,
            status: created.status,
            method: created.method,
          },
          tx,
        },
        actor,
        req,
      );

      return created;
    });

    return this.findOne(payment.id);
  }

  /**
   * Only editable while unverified. Once money is PAID the row is financial
   * history and is corrected via verify/refund, never by editing it.
   */
  async update(id: number, dto: UpdatePaymentDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.payment.findUniqueOrThrow({ where: { id } });

    if (isSettled(existing.status)) {
      throw new ConflictException(
        'A verified payment cannot be edited. Use verify, reject or refund instead.',
      );
    }
    if (dto.transactionReference && dto.transactionReference !== existing.transactionReference) {
      const clash = await this.prisma.payment.findUnique({
        where: { transactionReference: dto.transactionReference },
      });
      if (clash) throw new ConflictException('That transaction reference is already used');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          action: 'payment.updated',
          entity: AuditEntity.PAYMENT,
          entityId: id,
          oldValue: existing,
          newValue: dto,
          metadata: { changed: Object.keys(dto) },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  // ------------------------------------------------------------------
  // Verify / reject / refund
  //
  // Rule 6: verification is always audited.
  // Rule 8: a refund never rewrites history — it records the refunded amount
  // and the reason on the original row.
  // ------------------------------------------------------------------

  async verify(id: number, dto: VerifyPaymentDto, actor: AuditActor, req: Request) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });

    if (payment.status === PaymentStatus.PAID) {
      throw new ConflictException('Payment is already verified');
    }
    if (isClosed(payment.status)) {
      throw new ConflictException(`A ${payment.status} payment cannot be verified`);
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: {
          status: PaymentStatus.PAID,
          paidAt: payment.paidAt ?? now,
          verifiedById: actor.id,
          verifiedAt: now,
          notes: dto.notes ?? payment.notes,
        },
      });

      // An optional renewal closes the loop between money and service, using
      // the same anchor rule as the subscriptions module so dates cannot drift.
      let renewedSubscriptionId: number | null = null;
      if (dto.renewSubscription && payment.subscriptionId && payment.subscription) {
        const subscription = payment.subscription;
        const anchor =
          subscription.expiresAt && subscription.expiresAt > now ? subscription.expiresAt : now;
        const newExpiry = this.addInterval(anchor, subscription.billingInterval);

        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            expiresAt: newExpiry,
            status: subscription.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
            endedAt: null,
          },
        });
        await tx.license.updateMany({
          where: { subscriptionId: subscription.id, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
          data: { expiresAt: newExpiry, version: { increment: 1 } },
        });
        renewedSubscriptionId = subscription.id;
      }

      await this.audit.record(
        {
          action: 'payment.verified',
          entity: AuditEntity.PAYMENT,
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.PAID, paidAt: now },
          metadata: { notes: dto.notes, renewedSubscriptionId, verifiedBy: actor.email },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }


  async reject(id: number, dto: RejectPaymentDto, actor: AuditActor, req: Request) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });

    if (payment.status === PaymentStatus.PAID) {
      throw new ConflictException('A verified payment cannot be rejected — refund it instead');
    }
    if (payment.status === PaymentStatus.CANCELLED) {
      throw new ConflictException('Payment is already cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.CANCELLED, notes: dto.reason },
      });
      await this.audit.record(
        {
          action: 'payment.rejected',
          entity: AuditEntity.PAYMENT,
          entityId: id,
          oldValue: { status: payment.status },
          newValue: { status: PaymentStatus.CANCELLED, reason: dto.reason },
          tx,
        },
        actor,
        req,
      );
    });

    return this.findOne(id);
  }

  async refund(id: number, dto: RefundPaymentDto, actor: AuditActor, req: Request) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });

    if (payment.status !== PaymentStatus.PAID) {
      throw new ConflictException('Only a verified payment can be refunded');
    }

    const remaining = payment.amount - payment.refundedAmount;
    if (dto.amount > remaining) {
      throw new BadRequestException(
        `Cannot refund ${dto.amount}: only ${remaining} in minor units remain refundable`,
      );
    }

    const newRefunded = payment.refundedAmount + dto.amount;
    const fullyRefunded = newRefunded >= payment.amount;

    await this.prisma.$transaction(async (tx) => {
      // The original row is preserved; only the refunded total and status move.
      await tx.payment.update({
        where: { id },
        data: {
          refundedAmount: newRefunded,
          refundReason: dto.reason,
          status: fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
        },
      });

      // A full refund ends the service it paid for.
      if (fullyRefunded && payment.subscriptionId) {
        await tx.subscription.updateMany({
          where: { id: payment.subscriptionId },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            endedAt: new Date(),
            autoRenew: false,
          },
        });
        await tx.license.updateMany({
          where: { subscriptionId: payment.subscriptionId, status: { notIn: ['REVOKED', 'SUSPENDED'] } },
          data: { status: 'EXPIRED' },
        });
      }

      await this.audit.record(
        {
          action: 'payment.refunded',
          entity: AuditEntity.PAYMENT,
          entityId: id,
          oldValue: { refundedAmount: payment.refundedAmount, status: payment.status },
          newValue: { refundedAmount: newRefunded, status: fullyRefunded ? 'REFUNDED' : 'PAID' },
          metadata: { amount: dto.amount, reason: dto.reason, fullyRefunded },
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

  private buildOrderBy(query: Record<string, any>): Prisma.PaymentOrderByWithRelationInput {
    const field = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'createdAt';
    return {
      [field]: query.sortOrder === 'asc' ? 'asc' : 'desc',
    } as Prisma.PaymentOrderByWithRelationInput;
  }

  private addInterval(from: Date, interval: BillingInterval, periods = 1): Date {
    switch (interval) {
      case BillingInterval.MONTHLY:
        return addMonths(from, periods);
      case BillingInterval.QUARTERLY:
        return addMonths(from, 3 * periods);
      case BillingInterval.YEARLY:
        return addYears(from, periods);
      default:
        return addMonths(from, periods);
    }
  }
}

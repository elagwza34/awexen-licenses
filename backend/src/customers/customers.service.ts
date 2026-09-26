import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEntity, CustomerStatus, LicenseStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { startOfMonth } from 'date-fns';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

const SORTABLE = new Set(['createdAt', 'name', 'company', 'status', 'updatedAt']);

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: PaginationQueryDto & Record<string, any>): Promise<PaginatedResponse<any>> {
    const where: Prisma.CustomerWhereInput = { deletedAt: null };

    if (query.status) {
      const statuses = String(query.status).split(',').map((s) => s.trim().toUpperCase());
      const valid = statuses.filter((s) => Object.values(CustomerStatus).includes(s as CustomerStatus));
      if (valid.length) where.status = { in: valid as CustomerStatus[] };
    }

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { phone: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.country) where.country = query.country;

    const sortField = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'createdAt';
    const orderBy = {
      [sortField]: query.sortOrder === 'asc' ? 'asc' : 'desc',
    } as Prisma.CustomerOrderByWithRelationInput;

    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy,
        include: {
          _count: { select: { licenses: true, subscriptions: true, tickets: true } },
          licenses: {
            where: { status: { in: [LicenseStatus.ACTIVE, LicenseStatus.TRIAL, LicenseStatus.EXPIRING] } },
            select: { id: true, expiresAt: true, plan: { select: { name: true, nameAr: true } } },
            take: 1,
          },
        },
      }),
    ]);

    return paginated(rows, total, query.page, query.limit);
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: {
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          include: { plan: true, licenses: { select: { id: true, licenseKey: true, status: true } } },
        },
        licenses: {
          orderBy: { createdAt: 'desc' },
          include: {
            plan: { select: { id: true, name: true, nameAr: true, key: true } },
            _count: { select: { devices: true } },
          },
        },
        payments: { orderBy: { createdAt: 'desc' }, take: 20 },
        invoices: { orderBy: { issuedAt: 'desc' }, take: 20 },
        tickets: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { assignedAdmin: { select: { id: true, name: true } } },
        },
      },
    });

    if (!customer) throw new NotFoundException('Customer not found');

    const [deviceCount, totalPaid, activeLicenses, activations, auditLogs] = await Promise.all([
      this.prisma.device.count({ where: { license: { customerId: id }, status: 'ACTIVE' } }),
      this.prisma.payment.aggregate({
        where: { customerId: id, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.license.count({
        where: { customerId: id, status: { in: [LicenseStatus.ACTIVE, LicenseStatus.TRIAL, LicenseStatus.EXPIRING] } },
      }),
      this.prisma.activation.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { license: { select: { licenseKey: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { entity: AuditEntity.CUSTOMER, entityId: String(id) },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const currentSubscription =
      customer.subscriptions.find((s: { status: SubscriptionStatus }) =>
        ([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.PAST_DUE] as SubscriptionStatus[]).includes(
          s.status,
        ),
      ) ?? customer.subscriptions[0] ?? null;

    return {
      ...customer,
      stats: {
        activeLicenses,
        devices: deviceCount,
        totalPaid: totalPaid._sum.amount ?? 0,
        paymentsCount: totalPaid._count,
        currentPlan: currentSubscription?.plan.name ?? null,
        subscriptionExpiresAt: currentSubscription?.expiresAt ?? null,
        openTickets: customer.tickets.filter((t) =>
          ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER'].includes(t.status),
        ).length,
      },
      activationHistory: activations,
      auditLogs,
    };
  }

  async create(dto: CreateCustomerDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.customer.findUnique({ where: { email: dto.email } });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('A customer with this email already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({ data: dto });
      await this.audit.record(
        { action: 'customer.created', entity: AuditEntity.CUSTOMER, entityId: created.id, newValue: created, tx },
        actor,
        req,
      );
      return created;
    });
  }

  async update(id: number, dto: UpdateCustomerDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.customer.findFirstOrThrow({ where: { id, deletedAt: null } });

    if (dto.email && dto.email !== existing.email) {
      const clash = await this.prisma.customer.findUnique({ where: { email: dto.email } });
      if (clash && clash.id !== id) throw new ConflictException('A customer with this email already exists');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customer.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          action: 'customer.updated',
          entity: AuditEntity.CUSTOMER,
          entityId: id,
          oldValue: existing,
          newValue: updated,
          metadata: { changed: Object.keys(dto) },
          tx,
        },
        actor,
        req,
      );
      return updated;
    });
  }

  /**
   * Soft delete only. A customer with financial or licensing history must never
   * be hard-deleted — those records are the audit trail.
   */
  async remove(id: number, actor: AuditActor, req: Request) {
    const customer = await this.prisma.customer.findFirstOrThrow({ where: { id, deletedAt: null } });

    const [licenses, payments] = await Promise.all([
      this.prisma.license.count({ where: { customerId: id } }),
      this.prisma.payment.count({ where: { customerId: id } }),
    ]);

    if (licenses > 0 || payments > 0) {
      // Suspending preserves everything and stays reversible.
      const suspended = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.customer.update({
          where: { id },
          data: { status: CustomerStatus.SUSPENDED },
        });
        await this.audit.record(
          {
            action: 'customer.suspended_instead_of_delete',
            entity: AuditEntity.CUSTOMER,
            entityId: id,
            oldValue: { status: customer.status },
            newValue: { status: CustomerStatus.SUSPENDED },
            metadata: { licenses, payments, note: 'Deletion blocked because history exists' },
            tx,
          },
          actor,
          req,
        );
        return updated;
      });
      return {
        deleted: false,
        suspended: true,
        customer: suspended,
        message: 'This customer has licenses or payments, so the record was suspended instead of deleted.',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(
        {
          action: 'customer.soft_deleted',
          entity: AuditEntity.CUSTOMER,
          entityId: id,
          oldValue: { email: customer.email },
          tx,
        },
        actor,
        req,
      );
    });

    return { deleted: true, suspended: false, message: 'Customer archived' };
  }

  async stats() {
    const [total, active, trial, suspended, newThisMonth] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({ where: { deletedAt: null, status: CustomerStatus.ACTIVE } }),
      this.prisma.customer.count({
        where: { deletedAt: null, subscriptions: { some: { status: SubscriptionStatus.TRIAL } } },
      }),
      this.prisma.customer.count({ where: { deletedAt: null, status: CustomerStatus.SUSPENDED } }),
      this.prisma.customer.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth(new Date()) } } }),
    ]);

    return {
      totalCustomers: total,
      activeCustomers: active,
      trialCustomers: trial,
      suspendedCustomers: suspended,
      newThisMonth,
    };
  }
}



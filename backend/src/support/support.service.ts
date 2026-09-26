import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditEntity, Prisma, TicketPriority, TicketStatus } from '@prisma/client';
import type { Request } from 'express';
import { type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

const SORTABLE = new Set(['createdAt', 'updatedAt', 'status', 'priority']);

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto & Record<string, any>): Promise<PaginatedResponse<any>> {
    const where: Prisma.SupportTicketWhereInput = {};
    if (query.status) where.status = query.status as TicketStatus;
    if (query.priority) where.priority = query.priority as TicketPriority;
    if (query.customerId) where.customerId = Number(query.customerId);
    if (query.assignedAdminId) where.assignedAdminId = Number(query.assignedAdminId);
    if (query.unassigned === 'true') where.assignedAdminId = null;
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { number: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { company: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: this.buildOrderBy(query),
        include: {
          customer: { select: { id: true, name: true, company: true, email: true } },
          assignedAdmin: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      }),
    ]);

    return paginated(rows, total, query.page, query.limit);
  }

  async findOne(id: number) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, company: true, email: true, phone: true } },
        assignedAdmin: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' }, include: { admin: { select: { id: true, name: true } } } },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket;
  }

  /** Counts by status, for the support dashboard. */
  async summary() {
    const grouped = await this.prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } });
    const open = await this.prisma.supportTicket.count({
      where: { status: { in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING_CUSTOMER] } },
    });
    return {
      data: grouped.map((g) => ({ status: g.status, count: g._count._all })),
      openTickets: open,
    };
  }

  /** Human-friendly sequential number, e.g. TKT-2026-000042. */
  private async nextNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.supportTicket.count();
    return `TKT-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async create(
    dto: { customerId: number; licenseId?: number; subject: string; message: string; priority?: TicketPriority },
    actor: AuditActor,
    req: Request,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, deletedAt: null },
    });
    if (!customer) throw new NotFoundException('Customer not found');

    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          number: await this.nextNumber(),
          customerId: dto.customerId,
          licenseId: dto.licenseId,
          subject: dto.subject,
          priority: dto.priority ?? TicketPriority.MEDIUM,
          status: TicketStatus.OPEN,
          assignedAdminId: actor.id,
          messages: { create: { body: dto.message, adminId: actor.id, type: 'INTERNAL_NOTE' } },
        },
      });

      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'support.ticket_created',
          entity: AuditEntity.SUPPORT_TICKET,
          entityId: String(created.id),
          newValue: { number: created.number, subject: created.subject, priority: created.priority },
          ip: req.ip ?? null,
        },
      });

      return created;
    });

    return this.findOne(ticket.id);
  }

  /** Reply or internal note. Internal notes are never sent to the customer. */
  async reply(
    id: number,
    body: string,
    type: 'REPLY' | 'INTERNAL_NOTE',
    actor: AuditActor,
    req: Request,
  ) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });

    // Replying to a resolved ticket implicitly reopens it.
    const nextStatus =
      ticket.status === TicketStatus.RESOLVED || ticket.status === TicketStatus.CLOSED
        ? TicketStatus.OPEN
        : ticket.status;

    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicketMessage.create({ data: { ticketId: id, adminId: actor.id, body, type } });
      await tx.supportTicket.update({ where: { id }, data: { status: nextStatus } });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: type === 'REPLY' ? 'support.replied' : 'support.note_added',
          entity: AuditEntity.SUPPORT_TICKET,
          entityId: String(id),
          newValue: { type, length: body.length },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  async updateStatus(id: number, status: TicketStatus, actor: AuditActor, req: Request) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });
    if (ticket.status === status) return this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({
        where: { id },
        data: {
          status,
          resolvedAt: status === TicketStatus.RESOLVED ? new Date() : null,
          closedAt: status === TicketStatus.CLOSED ? new Date() : null,
        },
      });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'support.status_changed',
          entity: AuditEntity.SUPPORT_TICKET,
          entityId: String(id),
          oldValue: { status: ticket.status },
          newValue: { status },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  async assign(id: number, adminId: number | null, actor: AuditActor, req: Request) {
    const ticket = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id } });

    if (adminId) {
      const assignee = await this.prisma.admin.findUnique({ where: { id: adminId } });
      if (!assignee) throw new NotFoundException('Admin not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { assignedAdminId: adminId } });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'support.assigned',
          entity: AuditEntity.SUPPORT_TICKET,
          entityId: String(id),
          oldValue: { assignedAdminId: ticket.assignedAdminId },
          newValue: { assignedAdminId: adminId },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  private buildOrderBy(query: Record<string, any>): Prisma.SupportTicketOrderByWithRelationInput {
    const field = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'createdAt';
    return {
      [field]: query.sortOrder === 'asc' ? 'asc' : 'desc',
    } as Prisma.SupportTicketOrderByWithRelationInput;
  }
}
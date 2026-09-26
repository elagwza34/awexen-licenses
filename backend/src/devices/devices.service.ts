import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEntity, DeviceStatus, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

const SORTABLE = new Set(['activatedAt', 'lastSeenAt', 'lastValidationAt', 'status']);

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto & Record<string, any>): Promise<PaginatedResponse<any>> {
    const where: Prisma.DeviceWhereInput = {};

    if (query.status) where.status = query.status as DeviceStatus;
    if (query.licenseId) where.licenseId = Number(query.licenseId);
    if (query.customerId) where.license = { customerId: Number(query.customerId) };
    if (query.platform) where.platform = query.platform;

    if (query.search) {
      where.OR = [
        { deviceName: { contains: query.search, mode: 'insensitive' } },
        { appVersion: { contains: query.search, mode: 'insensitive' } },
        { license: { licenseKey: { contains: String(query.search).toUpperCase() } } },
        { license: { customer: { name: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }

    // Devices that have not checked in for a while are the ones worth chasing.
    if (query.staleDays) {
      const cutoff = new Date(Date.now() - Number(query.staleDays) * 86_400_000);
      where.OR = [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }];
    }

    const [total, rows] = await Promise.all([
      this.prisma.device.count({ where }),
      this.prisma.device.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: this.buildOrderBy(query),
        include: {
          license: {
            select: {
              id: true,
              licenseKey: true,
              status: true,
              maxDevices: true,
              customer: { select: { id: true, name: true, company: true } },
            },
          },
        },
      }),
    ]);

    return paginated(
      rows.map((row) => ({
        ...row,
        // The fingerprint hash is internal; only a prefix is ever shown.
        deviceFingerprint: row.deviceFingerprint.slice(0, 12),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async findOne(id: number) {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: {
        license: {
          include: {
            customer: { select: { id: true, name: true, company: true, email: true } },
            plan: { select: { id: true, name: true, nameAr: true } },
          },
        },
        validations: { orderBy: { createdAt: 'desc' }, take: 20 },
        activations: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!device) throw new NotFoundException('Device not found');

    return { ...device, deviceFingerprint: device.deviceFingerprint.slice(0, 12) };
  }

  // ------------------------------------------------------------------
  // Actions — all audited (business rule 4)
  // ------------------------------------------------------------------

  async block(id: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id } });

    if (device.status === DeviceStatus.REVOKED) {
      throw new ConflictException('A revoked device cannot be blocked');
    }
    if (device.status === DeviceStatus.BLOCKED) {
      throw new ConflictException('Device is already blocked');
    }

    await this.setStatus(id, device, DeviceStatus.BLOCKED, {
      blockedAt: new Date(),
      blockedReason: reason ?? null,
    }, 'device.blocked', reason, actor, req);

    return this.findOne(id);
  }

  async unblock(id: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const device = await this.prisma.device.findUniqueOrThrow({ where: { id } });

    if (device.status === DeviceStatus.REVOKED) {
      throw new ConflictException('A revoked device cannot be unblocked — issue a new licence');
    }
    if (device.status !== DeviceStatus.BLOCKED) {
      throw new BadRequestException('Device is not blocked');
    }

    await this.setStatus(
      id, device, DeviceStatus.ACTIVE,
      { blockedAt: null, blockedReason: null },
      'device.unblocked', reason, actor, req,
    );

    return this.findOne(id);
  }

  async revoke(id: number, reason: string | undefined, actor: AuditActor, req: Request) {
    const device = await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: { license: { select: { customerId: true } } },
    });

    if (device.status === DeviceStatus.REVOKED) {
      throw new ConflictException('Device is already revoked');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({
        where: { id },
        data: { status: DeviceStatus.REVOKED, revokedAt: new Date() },
      });

      // Record it as a reset so the activation history explains the freed slot.
      await tx.activation.create({
        data: {
          licenseId: device.licenseId,
          deviceId: device.id,
          customerId: device.license.customerId,
          activationType: 'DEVICE_RESET',
          success: true,
          performedById: actor.id,
          note: reason ?? 'Device revoked by administrator',
        },
      });

      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'device.revoked',
          entity: AuditEntity.DEVICE,
          entityId: String(id),
          oldValue: { status: device.status },
          newValue: { status: DeviceStatus.REVOKED, reason },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  /** Cross-device view: how many slots each licence is using. */
  async utilisation() {
    const licences = await this.prisma.license.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL', 'EXPIRING'] } },
      select: {
        id: true,
        licenseKey: true,
        maxDevices: true,
        customer: { select: { name: true, company: true } },
        _count: { select: { devices: { where: { status: DeviceStatus.ACTIVE } } } },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: licences.map((licence) => ({
        ...licence,
        freeSlots: Math.max(0, licence.maxDevices - licence._count.devices),
        utilisationPct:
          licence.maxDevices > 0
            ? Math.round((licence._count.devices / licence.maxDevices) * 100)
            : 0,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /** Status change + audit row, atomically. */
  private async setStatus(
    id: number,
    device: { id: number; status: DeviceStatus },
    status: DeviceStatus,
    data: Prisma.DeviceUpdateInput,
    action: string,
    reason: string | undefined,
    actor: AuditActor,
    req: Request,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.device.update({ where: { id }, data: { ...data, status } });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action,
          entity: AuditEntity.DEVICE,
          entityId: String(id),
          oldValue: { status: device.status },
          newValue: { status, reason },
          ip: req.ip ?? null,
        },
      });
    });
  }

  private buildOrderBy(query: Record<string, any>): Prisma.DeviceOrderByWithRelationInput {
    const field = SORTABLE.has(query.sortBy as string) ? (query.sortBy as string) : 'activatedAt';
    return {
      [field]: query.sortOrder === 'asc' ? 'asc' : 'desc',
    } as Prisma.DeviceOrderByWithRelationInput;
  }
}
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditEntity, FeatureCategory, FeatureStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

// ---- Features -------------------------------------------------------------

export class CreateFeatureDto {
  @ApiPropertyOptional({ example: 'MULTI_WAREHOUSE' })
  @IsString() @MaxLength(80)
  key!: string;

  @IsString() @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(120)
  nameAr?: string;

  @IsOptional() @IsString() @MaxLength(500)
  description?: string;

  @IsOptional() @IsEnum(FeatureCategory)
  category?: FeatureCategory;

  @IsOptional() @IsEnum(FeatureStatus)
  status?: FeatureStatus;
}

@Injectable()
export class FeaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { status?: string; category?: string; search?: string } = {}) {
    const where: Prisma.FeatureWhereInput = {};
    if (query.status) where.status = query.status as FeatureStatus;
    if (query.category) where.category = query.category as FeatureCategory;
    if (query.search) {
      where.OR = [
        { key: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameAr: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const features = await this.prisma.feature.findMany({
      where,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
      include: { _count: { select: { plans: true } } },
    });
    return { data: features };
  }

  async create(dto: CreateFeatureDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.feature.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException('A feature with this key already exists');

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.feature.create({ data: dto });
      await this.audit.record(
        { action: 'feature.created', entity: AuditEntity.FEATURE, entityId: created.id, newValue: created, tx },
        actor,
        req,
      );
      return created;
    });
  }

  async update(id: number, dto: Partial<CreateFeatureDto>, actor: AuditActor, req: Request) {
    const existing = await this.prisma.feature.findUniqueOrThrow({ where: { id } });

    if (dto.key && dto.key !== existing.key) {
      const activeLicenses = await this.prisma.license.count({ where: { plan: { features: { some: { featureId: id } } } } });
      if (activeLicenses > 0) {
        throw new ConflictException(
          'The feature key cannot change while licences depend on it — the customer application matches on this key',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.feature.update({ where: { id }, data: dto });
      await this.audit.record(
        { action: 'feature.updated', entity: AuditEntity.FEATURE, entityId: id, oldValue: existing, newValue: updated, tx },
        actor,
        req,
      );
      return updated;
    });
  }

  /**
   * Features are never hard-deleted: the customer application matches on the
   * feature key. Deprecating keeps historical licences intelligible.
   */
  async remove(id: number, actor: AuditActor, req: Request) {
    const feature = await this.prisma.feature.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { plans: true } } },
    });

    if (feature._count.plans > 0) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.feature.update({
          where: { id },
          data: { status: FeatureStatus.DEPRECATED },
        });
        await this.audit.record(
          {
            action: 'feature.deprecated',
            entity: AuditEntity.FEATURE,
            entityId: id,
            oldValue: { status: feature.status },
            newValue: { status: FeatureStatus.DEPRECATED },
            metadata: { plans: feature._count.plans },
            tx,
          },
          actor,
          req,
        );
        return result;
      });
      return { deleted: false, deprecated: true, feature: updated };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.feature.delete({ where: { id } });
      await this.audit.record(
        { action: 'feature.deleted', entity: AuditEntity.FEATURE, entityId: id, oldValue: feature, tx },
        actor,
        req,
      );
    });
    return { deleted: true, deprecated: false };
  }
}

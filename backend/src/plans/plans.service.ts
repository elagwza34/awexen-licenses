import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEntity, PlanStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { validatePmsPolicy } from './pms-plan-policy';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(query: { status?: string; search?: string } = {}) {
    const where: Prisma.PlanWhereInput = {};
    if (query.status) where.status = query.status as PlanStatus;
    if (query.search) {
      where.OR = [
        { key: { contains: query.search, mode: 'insensitive' } },
        { name: { contains: query.search, mode: 'insensitive' } },
        { nameAr: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const plans = await this.prisma.plan.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
      include: {
        features: { include: { feature: true } },
        _count: { select: { subscriptions: true, licenses: true } },
      },
    });

    return {
      data: plans.map((plan) => ({
        ...plan,
        featureKeys: plan.features.map((pf) => pf.feature.key),
      })),
    };
  }

  async findOne(id: number) {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        features: { include: { feature: true } },
        _count: { select: { subscriptions: true, licenses: true } },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return { ...plan, featureKeys: plan.features.map((pf) => pf.feature.key) };
  }

  private async validatePolicy(dto: CreatePlanDto | UpdatePlanDto,existing?:any) {
    if(!(dto.enforceEntitlements ?? existing?.enforceEntitlements ?? true)) {
      // Legacy plans may retain metadata-only edits, but selected features must
      // never be advertised or saved as an unrestricted PMS subscription.
      if(!existing || existing.enforceEntitlements || dto.featureIds !== undefined)
        throw new BadRequestException('يجب تطبيق مميزات وحدود الخطة داخل PMS عند إنشاء خطة أو تعديل مميزاتها.');
      return;
    }
    if((dto.status??existing?.status??'ACTIVE')==='ACTIVE'&&(dto.price??existing?.price??0)<=0&&!(dto.isTrialPlan??existing?.isTrialPlan))throw new BadRequestException('حدد سعر الخطة قبل تفعيلها للبيع، أو عرّفها صراحةً كخطة تجربة.');
    const features=dto.featureIds ? await this.prisma.feature.findMany({where:{id:{in:dto.featureIds}}}) : existing?.features?.map((x:any)=>x.feature) ?? [];
    if(dto.featureIds && (features.length!==new Set(dto.featureIds).size||new Set(dto.featureIds).size!==dto.featureIds.length))throw new BadRequestException('اختر مميزات موجودة بدون تكرار.');
    const error=validatePmsPolicy(features.map((x:any)=>x.key),{maxBranches:dto.maxBranches??existing?.maxBranches??1,maxWarehouses:dto.maxWarehouses??existing?.maxWarehouses??1});
    if(error)throw new BadRequestException(error);
  }
  async create(dto: CreatePlanDto, actor: AuditActor, req: Request) {
    await this.validatePolicy(dto);
    const existing = await this.prisma.plan.findUnique({ where: { key: dto.key } });
    if (existing) throw new ConflictException('A plan with this key already exists');

    const { featureIds, ...planData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          ...planData,
          enforceEntitlements: dto.enforceEntitlements ?? true,
          ...(featureIds?.length
            ? { features: { create: featureIds.map((featureId) => ({ featureId })) } }
            : {}),
        },
        include: { features: { include: { feature: true } } },
      });

      await this.audit.record(
        {
          action: 'plan.created',
          entity: AuditEntity.PLAN,
          entityId: created.id,
          newValue: { ...created, featureKeys: created.features.map((f) => f.feature.key) },
          tx,
        },
        actor,
        req,
      );
      return created;
    });
  }

  async update(id: number, dto: UpdatePlanDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.plan.findUniqueOrThrow({
      where: { id },
      include: { features: { include: { feature: true } } },
    });

    await this.validatePolicy(dto,existing);
    if (dto.key && dto.key !== existing.key) {
      const activeLicenses = await this.prisma.license.count({ where: { planId: id } });
      if (activeLicenses > 0) {
        throw new ConflictException('The plan key cannot change while licences reference it');
      }
    }

    const { featureIds, ...planData } = dto;

    return this.prisma.$transaction(async (tx) => {
      // Entitlements are replaced wholesale, so the stored set always matches
      // exactly what the admin selected.
      if (featureIds) {
        await tx.planFeature.deleteMany({ where: { planId: id } });
        if (featureIds.length) {
          await tx.planFeature.createMany({
            data: featureIds.map((featureId) => ({ planId: id, featureId })),
          });
        }
      }

      const updated = await tx.plan.update({
        where: { id },
        data: planData,
        include: { features: { include: { feature: true } } },
      });

      if (['featureIds','enforceEntitlements','maxUsers','maxBranches','maxWarehouses'].some(key => Object.prototype.hasOwnProperty.call(dto,key))) {
        await tx.license.updateMany({where:{planId:id},data:{version:{increment:1}}});
      }
      await this.audit.record(
        {
          action: 'plan.updated',
          entity: AuditEntity.PLAN,
          entityId: id,
          oldValue: { ...existing, featureKeys: existing.features.map((f) => f.feature.key) },
          newValue: { ...updated, featureKeys: updated.features.map((f) => f.feature.key) },
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
   * Remove any plan from sale; preserve every historical financial/license link.
   */
  async remove(id: number, actor: AuditActor, req: Request) {
    return this.prisma.$transaction(async (tx) => {
      // Serialize deletion with foreign-key references created by checkout or
      // enrollment; counts and mutation must observe the same protected plan.
      await tx.$queryRaw`SELECT id FROM plans WHERE id=${id} FOR UPDATE`;
      const plan = await tx.plan.findUniqueOrThrow({ where: { id } });
      const [licenses, subscriptions, payments] = await Promise.all([
        tx.license.count({ where: { planId: id } }),
        tx.subscription.count({ where: { planId: id } }),
        tx.payment.count({ where: { planId: id } }),
      ]);
      if (licenses > 0 || subscriptions > 0 || payments > 0) {
        const updated = await tx.plan.update({ where: { id }, data: { status: PlanStatus.ARCHIVED } });
        await this.audit.record(
          {
            action: 'plan.archived_instead_of_delete',
            entity: AuditEntity.PLAN,
            entityId: id,
            oldValue: { status: plan.status },
            newValue: { status: PlanStatus.ARCHIVED },
            metadata: { licenses, subscriptions, payments },
            tx,
          },
          actor,
          req,
        );
        return { deleted: false, archived: true, plan: updated,
          message: 'Plan removed from sale; historical subscriptions, payments and licences are preserved.' };
      }
      await tx.plan.delete({ where: { id } });
      await this.audit.record(
        { action: 'plan.deleted', entity: AuditEntity.PLAN, entityId: id, oldValue: plan, tx },
        actor,
        req,
      );
      return { deleted: true, archived: false };
    });
  }

  /** Subscriber counts per plan for the distribution chart. */
  async distribution() {
    const plans = await this.prisma.plan.findMany({
      where: { status: PlanStatus.ACTIVE },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        nameAr: true,
        price: true,
        currency: true,
        _count: { select: { subscriptions: true, licenses: true } },
      },
    });

    const data = await Promise.all(
      plans.map(async (plan) => {
        const active = await this.prisma.subscription.count({
          where: { planId: plan.id, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL] } },
        });
        const revenue = await this.prisma.subscription.aggregate({
          where: { planId: plan.id, status: SubscriptionStatus.ACTIVE },
          _sum: { price: true },
        });
        return {
          id: plan.id,
          key: plan.key,
          name: plan.name,
          nameAr: plan.nameAr,
          price: plan.price,
          currency: plan.currency,
          subscriptions: plan._count.subscriptions,
          activeSubscriptions: active,
          licenses: plan._count.licenses,
          mrr: revenue._sum.price ?? 0,
        };
      }),
    );

    return { data };
  }
}


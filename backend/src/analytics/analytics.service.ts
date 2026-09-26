import { Injectable } from '@nestjs/common';
import {
  BillingInterval,
  LicenseStatus,
  PaymentStatus,
  SubscriptionStatus,
  ValidationStatus,
} from '@prisma/client';
import { endOfDay, startOfDay, startOfMonth, subMonths } from 'date-fns';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * All dashboard and analytics numbers are computed from real database queries.
 * Nothing here is hardcoded, estimated or fabricated.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Headline counters for the main dashboard. */
  async overview() {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86_400_000);
    const startToday = startOfDay(now);
    const endToday = endOfDay(now);

    const [
      totalCustomers,
      activeCustomers,
      trialCustomers,
      activeLicenses,
      expiringLicenses,
      expiredLicenses,
      suspendedLicenses,
      revokedLicenses,
      activeDevices,
      pendingPayments,
      failedPayments,
      todayRevenue,
      mrr,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { deletedAt: null } }),
      this.prisma.customer.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.TRIAL } }),
      this.prisma.license.count({ where: { status: { in: [LicenseStatus.ACTIVE, LicenseStatus.TRIAL] } } }),
      this.prisma.license.count({
        where: { status: LicenseStatus.EXPIRING, expiresAt: { gte: now, lte: in7Days } },
      }),
      this.prisma.license.count({ where: { status: LicenseStatus.EXPIRED } }),
      this.prisma.license.count({ where: { status: LicenseStatus.SUSPENDED } }),
      this.prisma.license.count({ where: { status: LicenseStatus.REVOKED } }),
      this.prisma.device.count({ where: { status: 'ACTIVE' } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.PENDING } }),
      this.prisma.payment.count({ where: { status: PaymentStatus.FAILED } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.PAID, paidAt: { gte: startToday, lte: endToday } },
        _sum: { amount: true },
        _count: true,
      }),
      this.calculateMrr(),
    ]);

    return {
      customers: { total: totalCustomers, active: activeCustomers, trial: trialCustomers },
      licenses: {
        active: activeLicenses,
        expiring: expiringLicenses,
        expired: expiredLicenses,
        suspended: suspendedLicenses,
        revoked: revokedLicenses,
      },
      devices: { active: activeDevices },
      payments: {
        pending: pendingPayments,
        failed: failedPayments,
        todayRevenue: todayRevenue._sum.amount ?? 0,
        todayRevenueCount: todayRevenue._count,
      },
      revenue: { mrr, arr: mrr * 12 },
      currency: await this.defaultCurrency(),
    };
  }

  /**
   * MRR sums only recurring subscriptions, normalising quarterly and yearly
   * prices to a monthly figure. Lifetime revenue is not recurring.
   */
  async calculateMrr(): Promise<number> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: { status: SubscriptionStatus.ACTIVE, autoRenew: true },
      select: { price: true, billingInterval: true },
    });

    return subscriptions.reduce((total, sub) => {
      switch (sub.billingInterval) {
        case BillingInterval.MONTHLY:
          return total + sub.price;
        case BillingInterval.QUARTERLY:
          return total + Math.round(sub.price / 3);
        case BillingInterval.YEARLY:
          return total + Math.round(sub.price / 12);
        default:
          return total;
      }
    }, 0);
  }

  /** Monthly time series for the dashboard charts. */
  async timeseries(months = 12) {
    const series: Array<{
      month: string;
      revenue: number;
      newCustomers: number;
      newSubscriptions: number;
      activations: number;
      expirations: number;
    }> = [];

    for (let i = months - 1; i >= 0; i -= 1) {
      const from = startOfMonth(subMonths(new Date(), i));
      const to = endOfDay(new Date(from.getFullYear(), from.getMonth() + 1, 0));

      const [revenue, newCustomers, newSubscriptions, activations, expirations] = await Promise.all([
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.PAID, paidAt: { gte: from, lte: to } },
          _sum: { amount: true },
        }),
        this.prisma.customer.count({ where: { createdAt: { gte: from, lte: to }, deletedAt: null } }),
        this.prisma.subscription.count({ where: { createdAt: { gte: from, lte: to } } }),
        this.prisma.activation.count({ where: { createdAt: { gte: from, lte: to }, success: true } }),
        this.prisma.license.count({ where: { expiresAt: { gte: from, lte: to } } }),
      ]);

      series.push({
        month: from.toISOString().slice(0, 7),
        revenue: revenue._sum.amount ?? 0,
        newCustomers,
        newSubscriptions,
        activations,
        expirations,
      });
    }

    return { data: series, currency: await this.defaultCurrency() };
  }

  /**
   * Churn = subscriptions that ended this month / subscriptions active at the
   * start of this month.
   */
  async churn(months = 6) {
    const series: Array<{ month: string; churned: number; activeAtStart: number; rate: number }> = [];

    for (let i = months - 1; i >= 0; i -= 1) {
      const from = startOfMonth(subMonths(new Date(), i));
      const to = endOfDay(new Date(from.getFullYear(), from.getMonth() + 1, 0));

      const [churned, activeAtStart] = await Promise.all([
        this.prisma.subscription.count({
          where: {
            status: { in: [SubscriptionStatus.CANCELLED, SubscriptionStatus.EXPIRED] },
            endedAt: { gte: from, lte: to },
          },
        }),
        this.prisma.subscription.count({
          where: { startsAt: { lte: from }, OR: [{ endedAt: null }, { endedAt: { gte: from } }] },
        }),
      ]);

      series.push({
        month: from.toISOString().slice(0, 7),
        churned,
        activeAtStart,
        rate: activeAtStart > 0 ? Number(((churned / activeAtStart) * 100).toFixed(2)) : 0,
      });
    }

    return { data: series };
  }

  /** Subscriber split per plan for the distribution chart. */
  async planDistribution() {
    const plans = await this.prisma.plan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        key: true,
        name: true,
        nameAr: true,
        _count: { select: { subscriptions: true, licenses: true } },
      },
    });

    return {
      data: plans.map((plan) => ({
        id: plan.id,
        key: plan.key,
        name: plan.name,
        nameAr: plan.nameAr,
        subscriptions: plan._count.subscriptions,
        licenses: plan._count.licenses,
      })),
    };
  }

  /** Licence health breakdown, grouped by status. */
  async licenseHealth() {
    const grouped = await this.prisma.license.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return { data: grouped.map((g) => ({ status: g.status, count: g._count._all })) };
  }

  /** Validation success rate over a window — a product-health signal. */
  async validationHealth(days = 30) {
    const from = new Date();
    from.setDate(from.getDate() - days);

    const grouped = await this.prisma.licenseValidation.groupBy({
      by: ['status'],
      where: { createdAt: { gte: from } },
      _count: { _all: true },
    });

    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const success = grouped.find((g) => g.status === ValidationStatus.SUCCESS)?._count._all ?? 0;

    return {
      data: grouped.map((g) => ({ status: g.status, count: g._count._all })),
      meta: {
        total,
        success,
        failureRate: total > 0 ? Number((((total - success) / total) * 100).toFixed(2)) : 0,
        windowDays: days,
      },
    };
  }

  /** Recent activity feed for the dashboard. */
  async recentActivity(limit = 10) {
    const [activations, payments, licenses] = await Promise.all([
      this.prisma.activation.findMany({
        where: { success: true },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          customer: { select: { name: true, company: true } },
          license: { select: { licenseKey: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.PAID },
        orderBy: { paidAt: 'desc' },
        take: limit,
        include: { customer: { select: { name: true, company: true } } },
      }),
      this.prisma.license.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          customer: { select: { name: true, company: true } },
          plan: { select: { name: true } },
        },
      }),
    ]);

    return { activations, payments, licenses };
  }

  private async defaultCurrency(): Promise<string> {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'billing.default_currency' } });
    return typeof setting?.value === 'string' ? setting.value : 'EGP';
  }
}



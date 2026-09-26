import { Injectable, Logger } from '@nestjs/common';
import { LicenseStatus, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export interface LicenseStatusContext {
  status: LicenseStatus;
  reason?: string;
}

/**
 * Single source of truth for license/subscription state.
 *
 * Rule 12: "License status must always be determined server-side."
 * Nothing else may infer status from dates — every path goes through this
 * service so the rules cannot drift apart.
 *
 * Rules encoded here (all configurable via the settings table):
 *  - EXPIRING : expiresAt passed but still inside the grace period,
 *               or expires within the configured warning window
 *  - EXPIRED  : expiresAt passed and the grace period has elapsed
 *  - TRIAL    : trial flag set and still inside the trial window
 *  - SUSPENDED / REVOKED : explicit admin decisions, never overridden
 */
@Injectable()
export class LicenseStatusService {
  private readonly logger = new Logger(LicenseStatusService.name);
  private graceDays = 7;
  private expiringDays = 14;

  constructor(private readonly prisma: PrismaService) {}

  setFallbacks(graceDays: number, expiringDays: number): void {
    this.graceDays = graceDays;
    this.expiringDays = expiringDays;
  }

  /** Loads tunable values from the settings table. */
  async refreshSettings(): Promise<void> {
    try {
      const rows = await this.prisma.setting.findMany({
        where: { key: { in: ['license.grace_period_days', 'license.expiring_window_days'] } },
      });
      for (const row of rows) {
        const value = Number(row.value);
        if (!Number.isFinite(value)) continue;
        if (row.key === 'license.grace_period_days') this.graceDays = value;
        if (row.key === 'license.expiring_window_days') this.expiringDays = value;
      }
    } catch {
      this.logger.warn('Could not load license status settings — using fallbacks');
    }
  }

  /** Days remaining, floored at zero. null means lifetime. */
  daysRemaining(expiresAt: Date | null, now = new Date()): number | null {
    if (!expiresAt) return null;
    return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000));
  }

  /**
   * Derives the status a license SHOULD have right now, without mutating it.
   * Admin-forced states always win.
   */
  derive(
    license: { status: LicenseStatus; expiresAt: Date | null; isTrial: boolean; startsAt: Date },
    now = new Date(),
  ): LicenseStatusContext {
    if (license.status === LicenseStatus.SUSPENDED) {
      return { status: LicenseStatus.SUSPENDED, reason: 'Suspended by administrator' };
    }
    if (license.status === LicenseStatus.REVOKED) {
      return { status: LicenseStatus.REVOKED, reason: 'License revoked' };
    }

    if (license.expiresAt && now > license.expiresAt) {
      const graceEnds = new Date(license.expiresAt.getTime() + this.graceDays * 86_400_000);
      if (now <= graceEnds) {
        return {
          status: LicenseStatus.EXPIRING,
          reason: `Expired but within the ${this.graceDays}-day grace period`,
        };
      }
      return { status: LicenseStatus.EXPIRED, reason: 'License period has ended' };
    }

    if (license.expiresAt) {
      const daysLeft = (license.expiresAt.getTime() - now.getTime()) / 86_400_000;
      if (daysLeft <= this.expiringDays) {
        return { status: LicenseStatus.EXPIRING, reason: `Expires in ${Math.ceil(daysLeft)} day(s)` };
      }
    }

    if (license.isTrial) {
      return { status: LicenseStatus.TRIAL, reason: 'Trial license' };
    }

    return { status: LicenseStatus.ACTIVE };
  }

  /**
   * Reconciles stored status with derived status.
   * Expired licenses are transitioned, never deleted (business rule 1).
   */
  async reconcileLicense(licenseId: number, now = new Date()): Promise<LicenseStatus> {
    const license = await this.prisma.license.findUniqueOrThrow({ where: { id: licenseId } });
    const derived = this.derive(license, now);
    if (derived.status !== license.status) {
      await this.prisma.license.update({ where: { id: licenseId }, data: { status: derived.status } });
    }
    return derived.status;
  }

  /**
   * Bulk reconciliation for the scheduled expiry job.
   * Returns the ids of everything that changed, so the caller can audit them.
   */
  async reconcileAllLicenses(now = new Date()): Promise<number[]> {
    const licenses = await this.prisma.license.findMany({
      where: { status: { notIn: [LicenseStatus.REVOKED, LicenseStatus.SUSPENDED] } },
      select: { id: true, status: true, expiresAt: true, isTrial: true, startsAt: true },
    });

    const changed: number[] = [];
    for (const license of licenses) {
      const derived = this.derive(license, now);
      if (derived.status !== license.status) changed.push(license.id);
    }

    for (const id of changed) {
      await this.reconcileLicense(id, now);
    }
    if (changed.length) this.logger.log(`Reconciled ${changed.length} license(s)`);

    return changed;
  }

  /** Subscriptions follow the same grace-period philosophy. */
  deriveSubscription(
    subscription: { status: SubscriptionStatus; expiresAt: Date | null },
    now = new Date(),
  ): SubscriptionStatus {
    if (subscription.status === SubscriptionStatus.CANCELLED) return subscription.status;
    if (subscription.status === SubscriptionStatus.SUSPENDED) return subscription.status;
    if (subscription.expiresAt && now > subscription.expiresAt) return SubscriptionStatus.EXPIRED;
    return subscription.status;
  }
}


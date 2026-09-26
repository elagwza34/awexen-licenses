import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditEntity, Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LicenseStatusService } from './license-status.service';
import { SchedulerLockService } from './scheduler-lock.service';

/**
 * Scheduled licence maintenance.
 *
 * Every job here is idempotent: running it twice changes nothing the second
 * time, so a missed or duplicated tick can never corrupt state. That safety net
 * is a backstop, not a licence to run them concurrently — the advisory lock in
 * SchedulerLockService still ensures only one instance does the work, because
 * idempotence does not stop two writers from interleaving mid-run.
 */
@Injectable()
export class LicenseScheduler {
  private readonly logger = new Logger(LicenseScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly statusService: LicenseStatusService,
    private readonly audit: AuditService,
    private readonly lock: SchedulerLockService,
  ) {}

  /**
   * True when this instance owns the scheduler. Non-leaders skip the tick
   * quietly: a replica that never wins the race must not fill the log every
   * 15 minutes for the life of the process.
   */
  private shouldRun(): boolean {
    if (this.lock.leader) return true;
    this.logger.debug('Skipping tick — another instance holds the scheduler lock');
    return false;
  }

  /**
   * Hourly: reconcile stored licence status against the server-side rules.
   *
   * This is what makes EXPIRING/EXPIRED appear on their own. Without it, a
   * licence would only change state when a request happened to touch it.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcileLicenseStatuses(): Promise<number[]> {
    if (!this.shouldRun()) return [];
    try {
      const changed = await this.statusService.reconcileAllLicenses();
      if (changed.length) {
        this.logger.log(`Reconciled ${changed.length} licence(s): ${changed.join(', ')}`);
      }
      return changed;
    } catch (error) {
      this.logger.error('Licence reconciliation failed', (error as Error).stack);
      throw error;
    }
  }

  /**
   * Every 15 minutes: pick up changed licensing settings so a grace-period edit
   * applies without a restart.
   */
  @Cron('*/15 * * * *')
  async refreshLicensingSettings(): Promise<void> {
    if (!this.shouldRun()) return;
    try {
      await this.statusService.refreshSettings();
    } catch (error) {
      this.logger.error('Could not refresh licensing settings', (error as Error).stack);
    }
  }

  /**
   * Daily at 01:10 — past the renewal reminder window, queue a notification for
   * every licence that will expire soon.
   *
   * Uses the NOT EXISTS pattern so re-running on the same day does not create
   * duplicate notifications.
   */
  @Cron('10 1 * * *')
  async queueExpiryNotifications(): Promise<number> {
    if (!this.shouldRun()) return 0;
    try {
      const warningRow = await this.prisma.setting.findUnique({
        where: { key: 'notifications.expiry_warning_days' },
      });
      const warningDays = Number(warningRow?.value ?? 7);
      if (!Number.isFinite(warningDays) || warningDays <= 0) return 0;

      const now = new Date();
      const horizon = new Date(now.getTime() + warningDays * 86_400_000);

      const expiring = await this.prisma.license.findMany({
        where: {
          status: { in: ['ACTIVE', 'TRIAL', 'EXPIRING'] },
          expiresAt: { gte: now, lte: horizon },
        },
        select: { id: true, customerId: true, expiresAt: true },
      });

      if (!expiring.length) return 0;

      // One notification per licence per day, keyed by a natural dedupe marker.
      const existingToday = await this.prisma.notification.findMany({
        where: {
          type: 'LICENSE_EXPIRING',
          createdAt: { gte: new Date(now.toDateString()) },
        },
        select: { payload: true },
      });
      const alreadyQueued = new Set(
        existingToday
          .map((n: { payload: Prisma.JsonValue | null }) =>
            (n.payload as { licenceId?: number } | null)?.licenceId,
          )
          .filter((id: number | undefined): id is number => typeof id === 'number'),
      );

      let created = 0;
      for (const license of expiring) {
        if (alreadyQueued.has(license.id)) continue;
        const daysLeft = Math.max(
          0,
          Math.ceil((license.expiresAt!.getTime() - now.getTime()) / 86_400_000),
        );
        await this.prisma.notification.create({
          data: {
            customerId: license.customerId,
            type: 'LICENSE_EXPIRING',
            channel: 'IN_APP',
            title: `Licence ${license.id} expires in ${daysLeft} day(s)`,
            titleAr: `الترخيص ينتهي خلال ${daysLeft} يوم`,
            body: 'Renew the licence to avoid an interruption for the customer.',
            payload: { licenceId: license.id, daysLeft, expiresAt: license.expiresAt },
          },
        });
        created += 1;
      }

      if (created) this.logger.log(`Queued ${created} expiry notification(s)`);
      return created;
    } catch (error) {
      this.logger.error('Expiry notification job failed', (error as Error).stack);
      throw error;
    }
  }

  /**
   * Daily: audit the licences that changed status since the previous run.
   *
   * Written by the scheduler (adminId null) because no human performed it.
   */
  @Cron('40 1 * * *')
  async auditRecentTransitions(): Promise<number> {
    if (!this.shouldRun()) return 0;
    try {
      const since = new Date(Date.now() - 24 * 3_600_000);
      const transitions = await this.prisma.license.findMany({
        where: { updatedAt: { gte: since } },
        select: { id: true, status: true, updatedAt: true },
        take: 200,
      });

      for (const license of transitions) {
        await this.audit.record({
          action: 'license.status_reconciled',
          entity: AuditEntity.LICENSE,
          entityId: license.id,
          newValue: { status: license.status, at: license.updatedAt },
          metadata: { source: 'scheduler' },
        });
      }

      if (transitions.length) {
        this.logger.log(`Audited ${transitions.length} licence transition(s)`);
      }
      return transitions.length;
    } catch (error) {
      this.logger.error('Transition audit job failed', (error as Error).stack);
      throw error;
    }
  }
}

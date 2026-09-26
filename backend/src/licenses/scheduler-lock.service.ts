import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Leader election for the scheduled jobs.
 *
 * The API is stateless and may be scaled to N replicas, but the maintenance
 * jobs must not run N times: two instances reconciling licences concurrently
 * would produce duplicate notifications, double refunds and inconsistent audit
 * trails. So every instance races for a Postgres advisory lock and only the
 * winner schedules work.
 *
 * `pg_try_advisory_lock` (session-scoped) is used rather than the xact variant
 * because cron ticks are independent of each other; the lock is taken once at
 * boot and released on shutdown.
 */
@Injectable()
export class SchedulerLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerLockService.name);

  /** Session-scoped advisory lock key, unique to this app. */
  private static readonly LOCK_KEY = 0x4c494345; // "LICE"

  private isLeader = false;
  private acquiredAt: Date | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.isLeader = await this.tryAcquire();
    if (this.isLeader) {
      this.acquiredAt = new Date();
      this.logger.log('Scheduler lock acquired — this instance will run the jobs');
    } else {
      this.logger.warn(
        'Another instance holds the scheduler lock — this one will serve traffic only',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Only unlock if we hold it. Releasing a lock owned by another session
    // would be a no-op, but the explicit check keeps the intent clear and
    // avoids stealing a lock that a successor has already taken.
    if (!this.isLeader) return;
    try {
      await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${SchedulerLockService.LOCK_KEY}::bigint)`;
      this.logger.log('Scheduler lock released');
    } catch (error) {
      // A failure here only leaves the lock to expire with the connection,
      // which is safe because the jobs are idempotent.
      this.logger.warn('Could not release the scheduler lock cleanly', (error as Error).message);
    }
  }

  private async tryAcquire(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${SchedulerLockService.LOCK_KEY}::bigint) AS locked
      `;
      return rows[0]?.locked === true;
    } catch (error) {
      // Losing the database at boot must not stop the API from serving
      // traffic; it only means this instance does not run the jobs.
      this.logger.error('Could not attempt the scheduler lock', (error as Error).message);
      return false;
    }
  }

  get leader(): boolean {
    return this.isLeader;
  }

  /** Guard for manual triggers: only the leader may run a job out of band. */
  assertLeader(): void {
    if (!this.isLeader) {
      throw new ServiceUnavailableException(
        'The scheduled jobs are held by another instance. Retry against the leader, ' +
          'or run a single replica.',
      );
    }
  }

  status() {
    return {
      isLeader: this.isLeader,
      acquiredAt: this.acquiredAt?.toISOString() ?? null,
      lockKey: SchedulerLockService.LOCK_KEY,
    };
  }
}

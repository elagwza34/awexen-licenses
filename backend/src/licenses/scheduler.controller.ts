import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CurrentAdmin, RequirePermissions } from '../common/decorators';
import { LicenseScheduler } from './license-scheduler.service';
import { SchedulerLockService } from './scheduler-lock.service';

/** The jobs that can be triggered by hand, keyed by the name accepted in the body. */
const JOBS = [
  'reconcile-licenses',
  'refresh-settings',
  'queue-expiry-notifications',
  'audit-transitions',
] as const;

type JobName = (typeof JOBS)[number];

class RunJobDto {
  @IsIn(JOBS, { message: `job must be one of: ${JOBS.join(', ')}` })
  job!: JobName;
}

const RUNNERS: Record<JobName, (scheduler: LicenseScheduler) => Promise<unknown>> = {
  'reconcile-licenses': (s) => s.reconcileLicenseStatuses(),
  'refresh-settings': (s) => s.refreshLicensingSettings(),
  'queue-expiry-notifications': (s) => s.queueExpiryNotifications(),
  'audit-transitions': (s) => s.auditRecentTransitions(),
};

@ApiTags('Scheduler')
@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly scheduler: LicenseScheduler,
    private readonly lock: SchedulerLockService,
  ) {}

  @Get('status')
  @RequirePermissions('admins.view')
  @ApiOperation({ summary: 'Whether this instance holds the scheduler lock' })
  status() {
    return this.lock.status();
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('admins.update')
  @ApiOperation({
    summary: 'Run a maintenance job immediately',
    description:
      'The jobs are idempotent, so running one twice changes nothing. Useful for ' +
      'checking whether a grace-period or expiry state is stale without waiting ' +
      'for the next tick. Refused when another instance holds the lock.',
  })
  async run(@CurrentAdmin('id') adminId: number, @Body() dto: RunJobDto) {
    // Only the leader may run a job: a non-leader cannot guarantee the leader
    // is not running it at the same moment.
    this.lock.assertLeader();

    const startedAt = new Date();
    const result = await RUNNERS[dto.job](this.scheduler);

    return {
      job: dto.job,
      ranAt: startedAt.toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      requestedBy: adminId,
      result: result ?? null,
    };
  }
}

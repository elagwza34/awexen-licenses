import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { LicenseScheduler } from './license-scheduler.service';
import { LicenseValidationController } from './license-validation.controller';
import { LicenseValidationService } from './license-validation.service';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';
import { LicenseStatusService } from './license-status.service';
import { SchedulerController } from './scheduler.controller';
import { SchedulerLockService } from './scheduler-lock.service';
import { PmsInstallationsService } from './pms-installations.service';
import { PmsInstallationsController } from './pms-installations.controller';

@Module({
  // The validation controller reads analytics for the health report, so it
  // reuses that single implementation rather than duplicating the query.
  imports: [AnalyticsModule],
  controllers: [LicensesController, LicenseValidationController, SchedulerController, PmsInstallationsController],
  providers: [
    PmsInstallationsService,
    LicensesService,
    LicenseStatusService,
    LicenseValidationService,
    LicenseScheduler,
    SchedulerLockService,
  ],
  exports: [LicensesService, LicenseStatusService, LicenseValidationService, SchedulerLockService],
})
export class LicensesModule {}


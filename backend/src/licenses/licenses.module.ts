import { Module } from '@nestjs/common';
import { LicenseScheduler } from './license-scheduler.service';
import { LicenseValidationController } from './license-validation.controller';
import { LicenseValidationService } from './license-validation.service';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';
import { LicenseStatusService } from './license-status.service';

@Module({
  controllers: [LicensesController, LicenseValidationController],
  providers: [LicensesService, LicenseStatusService, LicenseValidationService, LicenseScheduler],
  exports: [LicensesService, LicenseStatusService, LicenseValidationService],
})
export class LicensesModule {}


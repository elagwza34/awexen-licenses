import { Module } from '@nestjs/common';
import { LicenseValidationController } from './license-validation.controller';
import { LicenseValidationService } from './license-validation.service';
import { LicensesController } from './licenses.controller';
import { LicensesService } from './licenses.service';
import { LicenseStatusService } from './license-status.service';

@Module({
  controllers: [LicensesController, LicenseValidationController],
  providers: [LicensesService, LicenseStatusService, LicenseValidationService],
  exports: [LicensesService, LicenseStatusService, LicenseValidationService],
})
export class LicensesModule {}


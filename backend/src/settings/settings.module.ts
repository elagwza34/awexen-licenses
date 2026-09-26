import { Module } from '@nestjs/common';
import { LicensesModule } from '../licenses/licenses.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  // SettingsService pushes tunables into the licensing engine, so it needs the
  // services that consume them.
  imports: [LicensesModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}

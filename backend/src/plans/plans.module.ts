import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { SystemsController } from './systems.controller';

@Module({
  controllers: [PlansController, FeaturesController, SystemsController],
  providers: [PlansService, FeaturesService],
  exports: [PlansService, FeaturesService],
})
export class PlansModule {}

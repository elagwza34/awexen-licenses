import { Module } from '@nestjs/common';
import { FeaturesController } from './features.controller';
import { FeaturesService } from './features.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController, FeaturesController],
  providers: [PlansService, FeaturesService],
  exports: [PlansService, FeaturesService],
})
export class PlansModule {}

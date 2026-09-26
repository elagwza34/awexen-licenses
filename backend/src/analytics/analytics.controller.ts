import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators';
import { AnalyticsService } from './analytics.service';

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Dashboard counters' })
  overview() {
    return this.analytics.overview();
  }

  @Get('timeseries')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Revenue, customers, activations and expirations over time' })
  timeseries(@Query('months') months?: number) {
    return this.analytics.timeseries(months ? Math.min(Math.max(Number(months), 1), 36) : 12);
  }

  @Get('churn')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Monthly churn rate' })
  churn(@Query('months') months?: number) {
    return this.analytics.churn(months ? Math.min(Math.max(Number(months), 1), 36) : 6);
  }

  @Get('plan-distribution')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Subscribers per plan' })
  planDistribution() {
    return this.analytics.planDistribution();
  }

  @Get('license-health')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Licence status distribution' })
  licenseHealth() {
    return this.analytics.licenseHealth();
  }

  @Get('validation-health')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'License validation success rate' })
  validationHealth(@Query('days') days?: number) {
    return this.analytics.validationHealth(days ? Math.min(Math.max(Number(days), 1), 365) : 30);
  }

  @Get('recent-activity')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Latest activations, payments and licences' })
  recentActivity(@Query('limit') limit?: number) {
    return this.analytics.recentActivity(limit ? Math.min(Number(limit), 50) : 10);
  }

  @Get('mrr')
  @RequirePermissions('analytics.view')
  @ApiOperation({ summary: 'Monthly and annual recurring revenue' })
  async mrr() {
    const mrr = await this.analytics.calculateMrr();
    return { mrr, arr: mrr * 12 };
  }
}

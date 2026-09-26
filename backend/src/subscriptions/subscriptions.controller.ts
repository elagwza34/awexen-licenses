import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import {
  CancelSubscriptionDto,
  ChangeSubscriptionPlanDto,
  CreateSubscriptionDto,
  ListSubscriptionsQueryDto,
  RenewSubscriptionDto,
  SubscriptionActionDto,
  UpdateSubscriptionDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermissions('subscriptions.view')
  @ApiOperation({ summary: 'List subscriptions' })
  findAll(@Query() query: PaginationQueryDto & ListSubscriptionsQueryDto) {
    return this.subscriptions.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('subscriptions.view')
  @ApiOperation({ summary: 'Subscription detail with licences and payments' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.subscriptions.findOne(id);
  }

  @Post()
  @RequirePermissions('subscriptions.create')
  @ApiOperation({ summary: 'Create a subscription' })
  create(@Body() dto: CreateSubscriptionDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.subscriptions.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Update a subscription' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubscriptionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.update(id, dto, admin, req);
  }

  @Post(':id/renew')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Renew and push the new expiry to every bound licence' })
  renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewSubscriptionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.renew(id, dto, admin, req);
  }

  @Post(':id/extend')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Add extra days' })
  extend(
    @Param('id', ParseIntPipe) id: number,
    @Body('days') days: number,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.extend(id, Number(days), undefined, admin, req);
  }

  @Post(':id/suspend')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Suspend the subscription and its licences' })
  suspend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubscriptionActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.suspend(id, dto.reason, admin, req);
  }

  @Post(':id/reactivate')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Reactivate a suspended subscription' })
  reactivate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubscriptionActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.reactivate(id, dto.reason, admin, req);
  }

  @Post(':id/cancel')
  @RequirePermissions('subscriptions.update')
  @ApiOperation({ summary: 'Cancel the subscription' })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelSubscriptionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.cancel(id, dto, admin, req);
  }

  @Post(':id/change-plan')
  @RequirePermissions('subscriptions.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Move the subscription to another plan' })
  changePlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeSubscriptionPlanDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.subscriptions.changePlan(id, dto, admin, req);
  }
}

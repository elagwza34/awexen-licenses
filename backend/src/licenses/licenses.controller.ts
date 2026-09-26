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
  ChangeLicensePlanDto,
  CreateLicenseDto,
  ExpiryFilter,
  ExtendLicenseDto,
  LicenseActionDto,
  RenewLicenseDto,
  ResetDeviceDto,
  UpdateLicenseDto,
} from './dto/license.dto';
import { LicensesService } from './licenses.service';

@ApiTags('Licenses')
@Controller('licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'List licenses with search, filters, sorting and pagination' })
  findAll(@Query() query: PaginationQueryDto & Record<string, any>) {
    return this.licenses.findAll(query);
  }

  @Get('expiring')
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'Licenses grouped by expiration window' })
  findExpiring(@Query('filter') filter: ExpiryFilter = ExpiryFilter.THIRTY_DAYS) {
    return this.licenses.findExpiring(filter);
  }

  @Get('by-key/:key')
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'Look up a license by its key' })
  findByKey(@Param('key') key: string) {
    return this.licenses.findByKey(key);
  }

  @Get(':id')
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'License detail' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.licenses.findOne(id);
  }

  @Get(':id/payload')
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'Signed license payload plus the public verification key' })
  getPayload(@Param('id', ParseIntPipe) id: number) {
    return this.licenses.getSignedPayload(id);
  }

  @Get(':id/history')
  @RequirePermissions('licenses.view')
  @ApiOperation({ summary: 'Activation, validation and audit history' })
  history(@Param('id', ParseIntPipe) id: number) {
    return this.licenses.history(id);
  }

  @Post()
  @RequirePermissions('licenses.create')
  @ApiOperation({ summary: 'Issue a new license' })
  create(@Body() dto: CreateLicenseDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.licenses.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('licenses.update')
  @ApiOperation({ summary: 'Update license fields' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLicenseDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.update(id, dto, admin, req);
  }

  @Post(':id/renew')
  @RequirePermissions('licenses.update')
  @ApiOperation({ summary: 'Renew a license and its subscription atomically' })
  renew(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenewLicenseDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.renew(id, dto, admin, req);
  }

  @Post(':id/extend')
  @RequirePermissions('licenses.update')
  @ApiOperation({ summary: 'Add extra days to a license' })
  extend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ExtendLicenseDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.extend(id, dto, admin, req);
  }

  @Post(':id/suspend')
  @RequirePermissions('licenses.suspend')
  @ApiOperation({ summary: 'Suspend a license (reversible, kept in history)' })
  suspend(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LicenseActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.suspend(id, dto.reason, admin, req);
  }

  @Post(':id/reactivate')
  @RequirePermissions('licenses.activate')
  @ApiOperation({ summary: 'Reactivate a suspended license. Revoked licenses are rejected.' })
  reactivate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LicenseActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.reactivate(id, dto.reason, admin, req);
  }

  @Post(':id/revoke')
  @RequirePermissions('licenses.revoke')
  @ApiOperation({ summary: 'Permanently revoke a license, its devices and its subscription' })
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LicenseActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.revoke(id, dto.reason, admin, req);
  }

  @Post(':id/change-plan')
  @RequirePermissions('licenses.update')
  @ApiOperation({ summary: 'Move a license to another plan' })
  changePlan(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeLicensePlanDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.changePlan(id, dto, admin, req);
  }

  @Post(':id/reset-device')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices.reset')
  @ApiOperation({ summary: 'Release a device slot (always audited)' })
  resetDevice(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetDeviceDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.licenses.resetDevice(id, dto, admin, req);
  }
}

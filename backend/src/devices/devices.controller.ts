import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { DevicesService } from './devices.service';

export class DeviceActionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  reason?: string;
}

@ApiTags('Devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermissions('devices.view')
  @ApiOperation({ summary: 'List devices with their licence and customer' })
  findAll(@Query() query: PaginationQueryDto & Record<string, any>) {
    return this.devices.findAll(query);
  }

  @Get('utilisation')
  @RequirePermissions('devices.view')
  @ApiOperation({ summary: 'Device slot usage per licence' })
  utilisation() {
    return this.devices.utilisation();
  }

  @Get(':id')
  @RequirePermissions('devices.view')
  @ApiOperation({ summary: 'Device detail with recent validations and activations' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.devices.findOne(id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices.reset')
  @ApiOperation({ summary: 'Block a device' })
  block(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeviceActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.devices.block(id, dto.reason, admin, req);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices.reset')
  @ApiOperation({ summary: 'Unblock a device' })
  unblock(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeviceActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.devices.unblock(id, dto.reason, admin, req);
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('devices.reset')
  @ApiOperation({ summary: 'Revoke a device and free its slot' })
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeviceActionDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.devices.revoke(id, dto.reason, admin, req);
  }
}

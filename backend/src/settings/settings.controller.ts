import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { BulkUpdateSettingsDto, SettingsService, UpdateSettingDto } from './settings.service';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'List settings, grouped for the settings screen' })
  findAll(@Query('group') group?: string) {
    return this.settings.findAll(group);
  }

  @Get(':key')
  @RequirePermissions('settings.view')
  @ApiOperation({ summary: 'Read a single setting' })
  findOne(@Param('key') key: string) {
    return this.settings.findOne(key);
  }

  @Put(':key')
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update a setting. Sensitive settings require an explicit confirmation.' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.settings.update(key, dto, admin, req);
  }

  @Put()
  @RequirePermissions('settings.update')
  @ApiOperation({ summary: 'Update several settings at once' })
  bulkUpdate(@Body() dto: BulkUpdateSettingsDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.settings.bulkUpdate(dto, admin, req);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { CreateFeatureDto, FeaturesService } from './features.service';

@ApiTags('Features')
@Controller('features')
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Get()
  @RequirePermissions('features.view')
  @ApiOperation({ summary: 'List features' })
  findAll(@Query() query: { status?: string; category?: string; search?: string }) {
    return this.features.findAll(query);
  }

  @Post()
  @RequirePermissions('features.create')
  @ApiOperation({ summary: 'Create a feature' })
  create(@Body() dto: CreateFeatureDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.features.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('features.update')
  @ApiOperation({ summary: 'Update a feature' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateFeatureDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.features.update(id, dto, admin, req);
  }

  @Delete(':id')
  @RequirePermissions('features.delete')
  @ApiOperation({ summary: 'Delete a feature, or deprecate it when plans still grant it' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.features.remove(id, admin, req);
  }
}

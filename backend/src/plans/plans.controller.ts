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
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('Plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  @RequirePermissions('plans.view')
  @ApiOperation({ summary: 'List plans with their entitlements' })
  findAll(@Query() query: { status?: string; search?: string }) {
    return this.plans.findAll(query);
  }

  @Get('distribution')
  @RequirePermissions('plans.view')
  @ApiOperation({ summary: 'Subscriber and revenue split per plan' })
  distribution() {
    return this.plans.distribution();
  }

  @Get(':id')
  @RequirePermissions('plans.view')
  @ApiOperation({ summary: 'Plan detail' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.plans.findOne(id);
  }

  @Post()
  @RequirePermissions('plans.create')
  @ApiOperation({ summary: 'Create a plan' })
  create(@Body() dto: CreatePlanDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.plans.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('plans.update')
  @ApiOperation({ summary: 'Update a plan and replace its feature entitlements' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlanDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.plans.update(id, dto, admin, req);
  }

  @Delete(':id')
  @RequirePermissions('plans.delete')
  @ApiOperation({ summary: 'Delete a plan, or archive it when it is still in use' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.plans.remove(id, admin, req);
  }
}

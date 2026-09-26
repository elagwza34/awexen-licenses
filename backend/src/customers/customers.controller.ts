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
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'List customers' })
  findAll(@Query() query: PaginationQueryDto & Record<string, any>) {
    return this.customers.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'Customer counts for the dashboard' })
  stats() {
    return this.customers.stats();
  }

  @Get(':id')
  @RequirePermissions('customers.view')
  @ApiOperation({ summary: 'Customer detail with subscriptions, licenses, payments and history' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customers.findOne(id);
  }

  @Post()
  @RequirePermissions('customers.create')
  @ApiOperation({ summary: 'Create a customer' })
  create(@Body() dto: CreateCustomerDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.customers.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('customers.update')
  @ApiOperation({ summary: 'Update a customer' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.customers.update(id, dto, admin, req);
  }

  @Delete(':id')
  @RequirePermissions('customers.delete')
  @ApiOperation({
    summary: 'Archive a customer',
    description:
      'Customers with licenses or payments are suspended instead of deleted, because those records are permanent history.',
  })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.customers.remove(id, admin, req);
  }
}

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
  ApproveActivationDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  RefundPaymentDto,
  RejectPaymentDto,
  UpdatePaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'List payments with totals for the filtered set' })
  findAll(@Query() query: PaginationQueryDto & ListPaymentsQueryDto) {
    return this.payments.findAll(query);
  }

  @Get('summary')
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'Revenue summary' })
  summary() {
    return this.payments.summary();
  }

  @Get(':id')
  @RequirePermissions('payments.view')
  @ApiOperation({ summary: 'Payment detail' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.payments.findOne(id);
  }

  @Post()
  @RequirePermissions('payments.create')
  @ApiOperation({ summary: 'Record a payment (manual or imported)' })
  create(@Body() dto: CreatePaymentDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.payments.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('payments.create')
  @ApiOperation({ summary: 'Edit an unverified payment' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.payments.update(id, dto, admin, req);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.verify')
  @ApiOperation({ summary: 'Verify a payment, optionally renewing its subscription' })
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VerifyPaymentDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.payments.verify(id, dto, admin, req);
  }

  @Post(':id/approve-activation')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.verify')
  @ApiOperation({
    summary: 'Approve a portal activation request: confirm the payment and issue the licence',
    description:
      'Marks the payment paid, unlocks the download, then issues a licence. ' +
      'If the licence cannot be issued the payment stays confirmed and the reason ' +
      'is returned, so approving money is never lost.',
  })
  approveActivation(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveActivationDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.payments.approveActivation(id, dto, admin, req);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.verify')
  @ApiOperation({ summary: 'Reject a pending payment' })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPaymentDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.payments.reject(id, dto, admin, req);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('payments.refund')
  @ApiOperation({ summary: 'Refund part or all of a verified payment' })
  refund(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefundPaymentDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.payments.refund(id, dto, admin, req);
  }
}

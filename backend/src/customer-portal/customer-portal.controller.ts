import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators';
import { CustomerLoginDto, CustomerRegisterDto } from './dto/customer-portal.dto';
import { CustomerJwtGuard, CurrentCustomer } from './customer-jwt.guard';
import { CustomerPortalService } from './customer-portal.service';

@ApiTags('Customer portal (public)')
@Controller('portal')
export class CustomerPortalController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Public()
  @Post('register')
  // Registration is unauthenticated by nature, so it carries a tight IP limit:
  // without it this endpoint is a free way to create unlimited rows.
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @ApiOperation({
    summary: 'Create a customer portal account',
    description:
      'Registration alone does not unlock the installer. The owner confirms ' +
      'payment first, which is what sets downloadEnabled.',
  })
  register(@Body() dto: CustomerRegisterDto, @Req() req: Request) {
    return this.portal.register(dto, req);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // 10 attempts per IP per 5 minutes. A legitimate customer who mistypes twice
  // is not affected; a credential-stuffing run is stopped quickly.
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @ApiOperation({ summary: 'Sign in to the customer portal' })
  login(@Body() dto: CustomerLoginDto, @Req() req: Request) {
    return this.portal.login(dto, req);
  }

  @Get('me')
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'The signed-in customer' })
  me(@CurrentCustomer() customer: { id: number }) {
    return this.portal.me(customer.id);
  }

  @Get('overview')
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'Dashboard data: licences, devices, latest release' })
  overview(@CurrentCustomer() customer: { id: number }) {
    return this.portal.overview(customer.id);
  }

  @Get('licenses')
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({
    summary: 'Full licence keys for this customer',
    description:
      'The dashboard masks keys; this returns them in full and only for the ' +
      'signed-in customer.',
  })
  licenses(@CurrentCustomer() customer: { id: number }) {
    return this.portal.licenseKeys(customer.id);
  }

  @Get('download')
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({
    summary: 'Resolve the installer download',
    description: 'Returns 403 PAYMENT_PENDING until the owner confirms payment.',
  })
  download(@CurrentCustomer() customer: { id: number }) {
    return this.portal.download(customer.id);
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCookieAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators';
import { ReceiptStorageService } from '../payments/receipt-storage.service';
import {
  ActivationRequestDto,
  CustomerLoginDto,
  CustomerRegisterDto,
} from './dto/customer-portal.dto';
import { CustomerJwtGuard, CurrentCustomer } from './customer-jwt.guard';
import { CustomerPortalService } from './customer-portal.service';

@ApiTags('Customer portal (public)')
@Controller('portal')
export class CustomerPortalController {
  constructor(
    private readonly portal: CustomerPortalService,
    private readonly receipts: ReceiptStorageService,
  ) {}

  @Public()
  @Post('register')
  // Measured, not guessed. On this machine 100 concurrent registrations
  // complete in ~1.0s and a single DB round trip is 1ms, so the endpoint was
  // never near saturation — the old ceiling of 5 per 10 minutes simply could not
  // tell a launch-day queue from a credential-stuffing run, and the sixth real
  // customer behind a shared or NAT'd address was refused outright.
  //
  // 300 per minute comfortably admits a 100-strong burst. Script defence does
  // not come from this number: every successful registration costs a 19 MiB
  // Argon2id hash, so a flood is CPU-bound and slows the server down instead of
  // quietly creating endless rows. The per-account sign-in lockout in the
  // service is what actually stops password guessing.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
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
  // Was 10 per IP per 5 minutes, which an office, a university or a mobile
  // carrier reaches with legitimate staff alone. Password guessing is handled by
  // the per-account lockout in the service, which follows the email being tried
  // rather than the network it came from — the dimension an attacker can spread
  // across but cannot forge.
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in to the customer portal' })
  login(@Body() dto: CustomerLoginDto, @Req() req: Request) {
    return this.portal.login(dto, req);
  }

  // The @Public() on the guarded routes below is load-bearing. The global
  // JwtAuthGuard runs before any route-level guard, so without it an admin
  // token is demanded first and the portal's own guard never runs — every
  // signed-in customer would get 401. @Public() makes the global guard stand
  // down, and CustomerJwtGuard then does the real check.
  @Get('me')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'The signed-in customer' })
  me(@CurrentCustomer() customer: { id: number }) {
    return this.portal.me(customer.id);
  }

  @Get('overview')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'Dashboard data: licences, devices, latest release' })
  overview(@CurrentCustomer() customer: { id: number }) {
    return this.portal.overview(customer.id);
  }

  @Get('licenses')
  @Public()
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
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({
    summary: 'Resolve the installer download',
    description: 'Returns 403 PAYMENT_PENDING until the owner confirms payment.',
  })
  download(@CurrentCustomer() customer: { id: number }) {
    return this.portal.download(customer.id);
  }

  // ------------------------------------------------------ activation request

  @Get('public-catalogue')
  @Public()
  publicCatalogue() { return this.portal.catalogue(); }

  @Get('catalogue')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'Plans the customer can request an activation code for' })
  catalogue() {
    return this.portal.catalogue();
  }

  @Get('requests')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({ summary: 'This customer’s own activation requests' })
  requests(@CurrentCustomer() customer: { id: number }) {
    return this.portal.myRequests(customer.id);
  }

  /**
   * Serves a receipt the signed-in customer uploaded themselves.
   *
   * This exists because the stored `receiptUrl` is the owner's admin route, and
   * a `<a href>` from the portal cannot carry a bearer token anyway. The check
   * is ownership, not possession of the filename: a customer who guesses
   * another customer's payment id gets 404, because the query is scoped to
   * their own id rather than filtering after the fact.
   */
  @Get('requests/:id/receipt')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @ApiOperation({
    summary: 'Stream the receipt attached to one of my own requests',
    description: 'Returns 404 unless the request belongs to the signed-in customer.',
  })
  async myReceipt(
    @CurrentCustomer() customer: { id: number },
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { name } = await this.portal.ownReceipt(customer.id, id);
    const { stream, mime, size } = await this.receipts.read(name);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(size));
    // Personal financial data: never cached by a proxy, never framed.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.on('error', () => res.end());
    stream.pipe(res);
  }

  @Post('activation-request')
  @Public()
  @UseGuards(CustomerJwtGuard)
  @UseInterceptors(
    // 5 MB is far above a phone photo of a receipt and far below a payload
    // that could be used to fill the disk.
    FileInterceptor('receipt', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  // Four per quarter-hour. Enough for a real submission with a retried photo,
  // low enough that a script cannot flood the owner's review queue.
  @Throttle({ default: { limit: 4, ttl: 900_000 } })
  @ApiOperation({
    summary: 'Request an activation code and attach the bank-transfer receipt',
    description:
      'Creates a PENDING payment for the owner to review. Does not unlock the ' +
      'download or issue a licence on its own.',
  })
  async requestActivation(
    @CurrentCustomer() customer: { id: number },
    // Typed loosely on purpose: the project has no @types/multer, and the only
    // thing the handler does with the file is hand it straight to the storage
    // service, which re-validates the content itself.
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body() body: ActivationRequestDto,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException({
        message: 'صورة الحوالة مطلوبة.',
        details: ['أرفق صورة قسيمة التحويل لتتمكن من مراجعة الطلب.'],
      });
    }

    const receipt = await this.receipts.save(file);
    return this.portal.requestActivation(
      customer.id,
      {
        planId: Number(body.planId),
        amount: Number(body.amount),
        notes: body.notes,
        subscriptionId: body.subscriptionId ? Number(body.subscriptionId) : undefined,
        receipt,
      },
      req,
    );
  }
}

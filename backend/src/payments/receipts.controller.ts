import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ReceiptStorageService } from './receipt-storage.service';

/**
 * Streams uploaded receipts.
 *
 * Separate from the payments controller because this one is a pure file read
 * with no business rules: the id in the URL is the only input, and the storage
 * service refuses anything that is not a plain UUID plus an image extension.
 * JwtAuthGuard keeps it owner-only; the global guard would cover it anyway, but
 * being explicit here documents that a customer token must never read these.
 */
@ApiTags('Receipts')
@Controller('receipts')
@UseGuards(JwtAuthGuard)
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptStorageService) {}

  @Get(':name')
  @ApiOperation({ summary: 'Stream a stored bank-transfer receipt' })
  async get(@Param('name') name: string, @Res() res: Response): Promise<void> {
    const { stream, mime, size } = await this.receipts.read(name);

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(size));
    // A receipt is personal financial data: it must not be cached by a shared
    // proxy or embedded by another site.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    stream.on('error', () => res.end());
    stream.pipe(res);
  }
}

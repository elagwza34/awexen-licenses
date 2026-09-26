import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { LicenseCryptoService } from '../common/crypto/license-crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

@ApiTags('System')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LicenseCryptoService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness and dependency check' })
  async health() {
    const db = await this.prisma.isHealthy();
    return {
      status: db ? 'ok' : 'degraded',
      database: db ? 'up' : 'down',
      signingKeyLoaded: Boolean(this.crypto.getPublicKeyPem()),
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * The PUBLIC key is safe to distribute and must be embedded in the customer
   * application. The private key is never exposed by any endpoint.
   */
  @Public()
  @Get('public-key')
  @ApiOperation({ summary: 'License verification public key (PEM)' })
  publicKey() {
    return { publicKey: this.crypto.getPublicKeyPem() };
  }
}

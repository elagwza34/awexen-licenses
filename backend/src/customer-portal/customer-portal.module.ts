import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

/**
 * The customer-facing portal: sign-up, sign-in, licence overview and the
 * payment-gated installer download.
 *
 * It imports JwtModule rather than relying on the global one so the portal's
 * tokens are signed with the same secret but a distinct audience. The two
 * guards check that audience, which is what keeps a customer session from
 * opening the admin panel.
 */
@Module({
  imports: [PrismaModule, CryptoModule, JwtModule.register({})],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
  exports: [CustomerPortalService],
})
export class CustomerPortalModule {}

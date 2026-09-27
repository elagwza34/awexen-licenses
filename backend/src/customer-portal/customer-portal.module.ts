import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { CustomerPortalController } from './customer-portal.controller';
import { CustomerPortalService } from './customer-portal.service';

/**
 * The customer-facing portal: sign-up, sign-in, licence overview and the
 * payment-gated installer download.
 *
 * JwtModule is NOT registered here. AuthModule is @Global and already provides
 * a JwtService configured with JWT_ACCESS_SECRET; a local register({}) creates a
 * second instance with no secret, and the portal guard would then verify
 * against an empty key and reject every token. The two token types stay apart
 * through the audience claim, not through separate secrets — CustomerJwtGuard
 * requires 'customer-portal' and JwtAuthGuard requires 'owner-admin'.
 */
@Module({
  // PaymentsModule brings ReceiptStorageService, which validates the uploaded
  // bank-transfer receipt before it is written to disk.
  imports: [PrismaModule, CryptoModule, PaymentsModule],
  controllers: [CustomerPortalController],
  providers: [CustomerPortalService],
  exports: [CustomerPortalService],
})
export class CustomerPortalModule {}

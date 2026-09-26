import { Global, Module } from '@nestjs/common';
import { LicenseCryptoService } from './license-crypto.service';
import { SecurityService } from './security.service';

@Global()
@Module({
  providers: [LicenseCryptoService, SecurityService],
  // Both are consumed by auth, licenses and settings, so they must be exported.
  exports: [LicenseCryptoService, SecurityService],
})
export class CryptoModule {}

import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from './audit.service';

@Global()
@Module({
  // PrismaService is provided here explicitly so the dependency resolves even
  // if this module is instantiated before the global PrismaModule.
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomerMailService } from './customer-mail.service';

@Module({
  imports: [PrismaModule],
  providers: [CustomerMailService],
  exports: [CustomerMailService],
})
export class CustomerMailModule {}

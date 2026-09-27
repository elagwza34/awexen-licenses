import { Module } from '@nestjs/common';
import { LicensesModule } from '../licenses/licenses.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ReceiptsController } from './receipts.controller';
import { ReceiptStorageService } from './receipt-storage.service';

@Module({
  // LicensesModule is imported so approving a portal activation can issue the
  // licence through the one implementation that owns key generation and
  // signing, rather than a second copy of that logic here.
  imports: [LicensesModule],
  controllers: [PaymentsController, ReceiptsController],
  providers: [PaymentsService, ReceiptStorageService],
  // ReceiptStorageService is exported so the customer portal can validate and
  // store a customer's upload with the same rules the admin side uses, instead
  // of growing a second, looser copy of them.
  exports: [PaymentsService, ReceiptStorageService],
})
export class PaymentsModule {}

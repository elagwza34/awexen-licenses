import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  customerId!: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  subscriptionId?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  invoiceId?: number;

  @ApiProperty({ description: 'Amount in minor units (piasters/cents)' })
  @Type(() => Number) @IsInt() @Min(1)
  amount!: number;

  @ApiPropertyOptional({ default: 'EGP' }) @IsOptional() @IsString() @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ enum: PaymentMethod, default: PaymentMethod.BANK_TRANSFER })
  @IsOptional() @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus, default: PaymentStatus.PENDING })
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({
    description: 'Bank/gateway reference. Must be unique so a transfer cannot be imported twice.',
  })
  @IsOptional() @IsString() @MaxLength(120)
  transactionReference?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  receiptUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;
}

export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {}

export class VerifyPaymentDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  renewSubscription?: boolean;
}

export class RejectPaymentDto {
  @ApiProperty() @IsString() @MaxLength(400)
  reason!: string;
}

/**
 * Approves a portal activation request in one step: the payment is marked
 * paid, the download unlocks, and a licence is issued for the chosen plan.
 *
 * Kept as its own endpoint rather than a flag on `verify` because the two
 * actions have different failure modes — approving money must never be blocked
 * by a licence that could not be issued, and vice versa.
 */
export class ApproveActivationDto {
  @ApiPropertyOptional({ description: 'Licence to issue. Defaults to the plan priced on the request.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId?: number;

  @ApiPropertyOptional({ description: 'Device allowance. Defaults to the plan’s own limit.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxDevices?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  notes?: string;

  /** Set false to confirm the money without issuing anything yet. */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  issueLicense?: boolean;
}

export class RefundPaymentDto {
  @ApiProperty({ description: 'Amount to refund, in minor units' })
  @Type(() => Number) @IsInt() @Min(1)
  amount!: number;

  @ApiProperty() @IsString() @MaxLength(400)
  reason!: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional() @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  customerId?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  subscriptionId?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reference?: string;
}

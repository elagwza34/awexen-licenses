import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';
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

export class CreateLicenseDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  customerId!: number;

  @ApiPropertyOptional({ description: 'Defaults to the customer active subscription' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  subscriptionId?: number;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  planId!: number;

  @ApiPropertyOptional({ description: 'Defaults to the plan device limit' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxDevices?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Omit for a lifetime license' })
  @IsOptional() @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isTrial?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Issue a fresh key for a revoked license' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  reissueOfId?: number;
}

export class UpdateLicenseDto extends PartialType(CreateLicenseDto) {}

export class RenewLicenseDto {
  @ApiPropertyOptional({
    description: 'Billing interval for the renewal. Defaults to the current one.',
    enum: BillingInterval,
  })
  @IsOptional() @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ description: 'Explicit new expiry date. Overrides the interval.' })
  @IsOptional() @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Add N intervals to the current expiry instead' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60)
  periods?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class ExtendLicenseDto {
  @ApiProperty({ description: 'Number of days to add' })
  @Type(() => Number) @IsInt() @Min(1) @Max(3650)
  days!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class LicenseActionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;

  @ApiPropertyOptional({ description: 'Required to confirm destructive actions' })
  @IsOptional() @IsString()
  confirm?: string;
}

export class ChangeLicensePlanDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  planId!: number;

  @ApiPropertyOptional({ description: 'Apply the new entitlements immediately' })
  @IsOptional() @IsBoolean()
  applyImmediately?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class LicenseValidationQueryDto {
  @ApiProperty() @IsString() @Length(10, 64)
  licenseKey!: string;
}

export enum ExpiryFilter {
  TODAY = 'today',
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
  EXPIRED = 'expired',
  GRACE = 'grace',
}

export class ListLicensesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  customerId?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  planId?: number;

  @ApiPropertyOptional({ description: 'Expiry window filter' })
  @IsOptional() @IsEnum(ExpiryFilter)
  expiry?: ExpiryFilter;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sortBy?: string;
}

export class ResetDeviceDto {
  @ApiProperty({ description: 'Device id to free the slot for' })
  @Type(() => Number) @IsInt() @Min(1)
  deviceId!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class CreateDeviceDto {
  @ApiProperty({ description: 'Raw fingerprint parts; hashed server-side' })
  @IsString() @Length(8, 500)
  fingerprint!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180)
  deviceName?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  platform?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  osVersion?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  appVersion?: string;
}

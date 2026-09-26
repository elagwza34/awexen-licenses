import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BillingInterval, SubscriptionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSubscriptionDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  customerId!: number;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  planId!: number;

  @ApiPropertyOptional({ description: 'Defaults to the plan price' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: 'Defaults to the plan currency' })
  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingInterval, description: 'Defaults to the plan interval' })
  @IsOptional() @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  autoRenew?: boolean;

  @ApiPropertyOptional({ description: 'Start date. Defaults to now.' })
  @IsOptional() @IsDateString()
  startsAt?: string;

  @ApiPropertyOptional({ description: 'Omit for a lifetime subscription' })
  @IsOptional() @IsDateString()
  expiresAt?: string;
}

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {}

export class RenewSubscriptionDto {
  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional() @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60)
  periods?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class SubscriptionActionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;

  @ApiPropertyOptional({ description: 'Refund to the period end instead of today' })
  @IsOptional() @IsBoolean()
  atPeriodEnd?: boolean;
}

export class ChangeSubscriptionPlanDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  planId!: number;

  @ApiPropertyOptional({ description: 'Apply the new entitlements immediately' })
  @IsOptional() @IsBoolean()
  applyImmediately?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400)
  reason?: string;
}

export class ListSubscriptionsQueryDto {
  @ApiPropertyOptional({ enum: SubscriptionStatus })
  @IsOptional() @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  customerId?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  planId?: number;

  @ApiPropertyOptional({ description: 'Only subscriptions expiring on or before this date' })
  @IsOptional() @IsDateString()
  expiresBefore?: string;

  @ApiPropertyOptional({ description: 'Only subscriptions expiring on or after this date' })
  @IsOptional() @IsDateString()
  expiresAfter?: string;
}

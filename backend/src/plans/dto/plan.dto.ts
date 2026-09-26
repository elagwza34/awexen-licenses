import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BillingInterval, PlanStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty({ example: 'PROFESSIONAL' })
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, { message: 'Key must be uppercase letters, digits and underscores' })
  @MaxLength(60)
  key!: string;

  @ApiProperty() @IsString() @MaxLength(120)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  nameAr?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Price in minor units (piasters/cents)', example: 49900 })
  @Type(() => Number) @IsInt() @Min(0)
  price!: number;

  @ApiPropertyOptional({ default: 'EGP' }) @IsOptional() @IsString() @Length(3, 3)
  currency?: string;

  @ApiPropertyOptional({ enum: BillingInterval, default: BillingInterval.MONTHLY })
  @IsOptional() @IsEnum(BillingInterval)
  billingInterval?: BillingInterval;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365)
  trialDays?: number;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  maxDevices?: number;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isPopular?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isTrialPlan?: boolean;

  @ApiPropertyOptional({ enum: PlanStatus, default: PlanStatus.ACTIVE })
  @IsOptional() @IsEnum(PlanStatus)
  status?: PlanStatus;

  @ApiPropertyOptional({ type: [Number], description: 'Feature ids granted by this plan' })
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true })
  featureIds?: number[];
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

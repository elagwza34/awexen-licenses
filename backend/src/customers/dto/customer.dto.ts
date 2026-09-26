import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CustomerStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty() @IsString() @MaxLength(160)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160)
  company?: string;

  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail() @MaxLength(180)
  email!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  address?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  city?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80)
  country?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  taxNumber?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ enum: CustomerStatus, default: CustomerStatus.ACTIVE })
  @IsOptional() @IsEnum(CustomerStatus)
  status?: CustomerStatus;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerStatsDto {
  @ApiProperty() totalCustomers!: number;
  @ApiProperty() activeCustomers!: number;
  @ApiProperty() trialCustomers!: number;
  @ApiProperty() suspendedCustomers!: number;
  @ApiProperty() newThisMonth!: number;
}

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional() @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  hasActiveLicense?: number;
}

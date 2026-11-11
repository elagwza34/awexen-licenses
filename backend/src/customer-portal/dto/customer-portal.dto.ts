import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class CustomerRegisterDto {
  @ApiPropertyOptional({ description: "Stable catalogue key, including the billing interval." })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  planKey?: string;

  @ApiProperty({ example: 'buyer@company.com' })
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(180)
  email!: string;

  @ApiProperty({ example: 'Ahmed Ali' })
  @IsString()
  @Length(2, 160)
  name!: string;

  @ApiPropertyOptional({ example: 'Ahmed Trading Co.' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'Egypt' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @ApiProperty({
    description:
      'At least 12 characters with an uppercase letter, a lowercase letter, a number and a symbol.',
  })
  @IsString()
  // Matches the panel's own policy. Duplicated here so the customer gets a
  // field-level error naming the missing rule instead of a generic rejection.
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$/,
    {
      message:
        'Use at least 12 characters including an uppercase letter, a lowercase letter, a number and a symbol.',
    },
  )
  password!: string;
}

export class CustomerLoginDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(180)
  email!: string;

  @ApiProperty()
  @IsString()
  // No length rule here: a wrong password must be reported as "incorrect",
  // not as a validation error that gives away the password policy.
  @MaxLength(200)
  password!: string;
}

export class ActivationRequestDto {
  @ApiProperty({ description: 'Plan the customer wants to activate.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  planId!: number;

  @ApiProperty({
    description: 'Amount in piastres (100 piastres = 1 EGP), as shown on the plan.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  subscriptionId?: number;

  @ApiPropertyOptional({ description: 'Bank reference, so the owner can match the transfer.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  notes?: string;
}

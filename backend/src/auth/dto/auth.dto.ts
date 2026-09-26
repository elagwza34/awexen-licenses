import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@company.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'A valid email address is required' })
  email!: string;

  @ApiProperty({ example: 'ChangeMe!12345' })
  @IsString()
  @MaxLength(200)
  password!: string;

  @ApiPropertyOptional({ description: 'TOTP code when 2FA is enabled on the account' })
  @IsOptional()
  @IsString()
  @Length(6, 6, { message: 'The 2FA code must be 6 digits' })
  totpCode?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 200, { message: 'The new password must be at least 12 characters' })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 200)
  newPassword!: string;
}

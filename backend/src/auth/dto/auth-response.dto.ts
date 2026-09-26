import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdminRoleKey } from '@prisma/client';

export class AuthAdminDto {
  @ApiProperty() id!: number;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty() status!: string;
  @ApiProperty() locale!: string;
  @ApiProperty({ enum: AdminRoleKey, isArray: true }) roles!: AdminRoleKey[];
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty() twoFactorEnabled!: boolean;
  @ApiPropertyOptional() lastLoginAt?: Date | null;
}

export class AuthTokensDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty({ description: 'Refresh token; also set as an httpOnly cookie' })
  refreshToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
  @ApiProperty() tokenType!: string;
}

export class LoginResponseDto {
  @ApiProperty() admin!: AuthAdminDto;
  @ApiProperty({ type: AuthTokensDto }) tokens!: AuthTokensDto;
}

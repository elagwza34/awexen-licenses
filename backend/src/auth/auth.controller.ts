import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentAdmin, Public, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';

const REFRESH_COOKIE = 'owner_rt';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  // Strict throttle: this is the single most attacked endpoint in the panel.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin sign-in' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, req, res);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the refresh token and issue a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    return this.auth.refresh(cookieToken ?? '', req, res);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @CurrentAdmin('id') adminId: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    return this.auth.logout(adminId, cookieToken, res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke every active session for the current admin' })
  async logoutAll(@CurrentAdmin('id') adminId: number) {
    return this.auth.logoutAll(adminId, 'LOGOUT_ALL');
  }

  @Get('me')
  @ApiOperation({ summary: 'Current admin profile, roles and permissions' })
  async me(@CurrentAdmin('id') adminId: number) {
    return this.auth.profile(adminId);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the current admin password (revokes other sessions)' })
  async changePassword(
    @CurrentAdmin('id') adminId: number,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(adminId, dto, req);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset' })
  @ApiResponse({ status: 200, description: 'Always returns the same generic message.' })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto.email, req);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a password reset' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, req);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions for the current admin' })
  async sessions(@CurrentAdmin('id') adminId: number) {
    return this.auth.sessions(adminId);
  }

  @Get('login-history')
  @RequirePermissions('admins.view')
  @ApiOperation({ summary: 'Recent sign-in attempts for the current admin' })
  async loginHistory(@CurrentAdmin('id') adminId: number, @Query('limit') limit?: number) {
    return this.auth.loginHistory(adminId, limit ? Number(limit) : 20);
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enable TOTP two-factor authentication' })
  async enable2fa(@CurrentAdmin('id') adminId: number, @Body('code') code: string) {
    return this.auth.enableTwoFactor(adminId, code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable TOTP two-factor authentication' })
  async disable2fa(@CurrentAdmin('id') adminId: number, @Body('code') code: string) {
    return this.auth.disableTwoFactor(adminId, code);
  }

  @Get('permissions')
  @ApiOperation({ summary: 'All permission keys available in the system' })
  async permissions(@CurrentAdmin() admin: AuthAdmin) {
    return { data: admin.permissions, roles: admin.roleKeys };
  }
}

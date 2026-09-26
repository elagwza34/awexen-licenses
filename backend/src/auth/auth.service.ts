import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditEntity, AdminStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LicenseCryptoService } from '../common/crypto/license-crypto.service';
import { SecurityService } from '../common/crypto/security.service';
import type { JwtPayload } from '../common/guards/jwt-auth.guard';
import { ChangePasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';
import type { AuthAdminDto, AuthTokensDto } from './dto/auth-response.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MINUTES = 15;
const ACCESS_TOKEN_TTL_SECONDS = 900;

type RoleWithPermissions = {
  role: { key: string; permissions: { permission: { key: string } }[] };
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: SecurityService,
    private readonly audit: AuditService,
    private readonly crypto: LicenseCryptoService,
  ) {}

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------

  async login(dto: LoginDto, req: Request, res: Response) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 400) ?? null;

    const admin = await this.prisma.admin.findUnique({
      where: { email: dto.email },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    // Identical error for unknown email and wrong password — no enumeration.
    if (!admin || admin.deletedAt) {
      await this.logAttempt(null, dto.email, false, 'INVALID_CREDENTIALS', ip, userAgent);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.status === AdminStatus.INACTIVE) {
      await this.logAttempt(admin.id, dto.email, false, 'ACCOUNT_INACTIVE', ip, userAgent);
      throw new ForbiddenException('This account has been deactivated');
    }

    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      await this.logAttempt(admin.id, dto.email, false, 'ACCOUNT_LOCKED', ip, userAgent);
      throw new UnauthorizedException('Account temporarily locked. Try again later.');
    }

    const passwordOk = await this.security.verifyPassword(dto.password, admin.passwordHash);
    if (!passwordOk) {
      await this.registerFailure(admin);
      const willLock = admin.failedLogins + 1 >= MAX_FAILED_LOGINS;
      await this.logAttempt(admin.id, dto.email, false, willLock ? 'LOCKED_OUT' : 'INVALID_PASSWORD', ip, userAgent);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.twoFactorEnabled) {
      if (!dto.totpCode) throw new UnauthorizedException('A 2FA code is required');
      const secret = this.decryptTotp(admin.twoFactorSecretEnc);
      if (!secret || !this.security.verifyTotp(secret, dto.totpCode)) {
        await this.logAttempt(admin.id, dto.email, false, 'INVALID_TOTP', ip, userAgent);
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip },
    });

    const tokens = await this.issueTokens(
      admin.id, admin.email, admin.name,
      admin.roles.map((r) => r.role.key),
      this.permissionsOf(admin.roles),
      ip, userAgent,
    );

    await this.logAttempt(admin.id, dto.email, true, null, ip, userAgent);
    await this.audit.record(
      { action: 'auth.login', entity: AuditEntity.ADMIN, entityId: admin.id, metadata: { ip, userAgent } },
      { id: admin.id, email: admin.email },
      req,
    );

    this.setRefreshCookie(res, tokens.refreshToken);
    return { admin: this.toAdminDto(admin), tokens };
  }

  // ------------------------------------------------------------------
  // Refresh — rotation with reuse detection
  // ------------------------------------------------------------------

  async refresh(rawToken: string, req: Request, res: Response) {
    if (!rawToken) throw new UnauthorizedException('Refresh token is missing');

    const tokenHash = this.security.hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      // Reuse of a rotated token means it leaked. Kill the whole family and
      // force a fresh login.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' },
      });
      this.logger.error(`Refresh token reuse detected for family ${stored.familyId} — family revoked`);
      throw new UnauthorizedException('Session compromised. Please sign in again.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const admin = await this.prisma.admin.findUnique({
      where: { id: stored.adminId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

    if (!admin || admin.deletedAt || admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Account is no longer active');
    }

    const ip = req.ip;
    const userAgent = req.headers['user-agent']?.toString().slice(0, 400) ?? null;

    // Rotate: revoke the used token, mint a replacement in the same family.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), revokedReason: 'ROTATED' },
    });

    const tokens = await this.issueTokens(
      admin.id, admin.email, admin.name,
      admin.roles.map((r) => r.role.key),
      this.permissionsOf(admin.roles),
      ip, userAgent, stored.familyId,
    );

    this.setRefreshCookie(res, tokens.refreshToken);
    return { admin: this.toAdminDto(admin), tokens };
  }

  // ------------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------------

  async logout(adminId: number, rawToken: string | undefined, res: Response) {
    await this.prisma.refreshToken.updateMany({
      where: rawToken
        ? { adminId, tokenHash: this.security.hashToken(rawToken), revokedAt: null }
        : { adminId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'LOGOUT' },
    });
    this.clearRefreshCookie(res);
    return { success: true };
  }

  /** Revoke every active session (used after password change/reset). */
  async logoutAll(adminId: number, reason: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return { revokedSessions: count };
  }

  // ------------------------------------------------------------------
  // Passwords
  // ------------------------------------------------------------------

  async changePassword(adminId: number, dto: ChangePasswordDto, req: Request) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });

    const ok = await this.security.verifyPassword(dto.currentPassword, admin.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const problems = SecurityService.assertPasswordStrength(dto.newPassword);
    if (problems.length) {
      throw new ForbiddenException({ message: 'Password is too weak', details: problems });
    }

    await this.prisma.admin.update({
      where: { id: adminId },
      data: {
        passwordHash: await this.security.hashPassword(dto.newPassword),
        passwordChangedAt: new Date(),
      },
    });

    // A password change must invalidate every other session.
    const revoked = await this.logoutAll(adminId, 'PASSWORD_CHANGED');

    await this.audit.record(
      { action: 'auth.password_changed', entity: AuditEntity.ADMIN, entityId: adminId, metadata: revoked },
      { id: adminId, email: admin.email },
      req,
    );

    return { success: true, ...revoked };
  }

  async forgotPassword(email: string, req: Request) {
    const admin = await this.prisma.admin.findUnique({ where: { email } });

    // Always respond identically so the endpoint cannot enumerate accounts.
    if (admin && !admin.deletedAt) {
      const resetToken = this.security.createOpaqueToken(32);
      await this.prisma.notification.create({
        data: {
          adminId: admin.id,
          type: 'PASSWORD_RESET',
          channel: 'IN_APP',
          title: 'Password reset requested',
          body: 'A password reset was requested for this account.',
          payload: { resetToken, expiresInMinutes: 30 },
        },
      });
      await this.audit.record(
        { action: 'auth.password_reset_requested', entity: AuditEntity.ADMIN, entityId: admin.id },
        { id: admin.id, email: admin.email },
        req,
      );
    }

    return {
      success: true,
      message: 'If an account exists for that email, a reset instruction has been issued.',
    };
  }

  async resetPassword(dto: ResetPasswordDto, req: Request) {
    // The pending set is tiny and JSONB token lookup is not indexed, so a
    // bounded scan is cheaper and more portable than a JSON path filter.
    const pending = await this.prisma.notification.findMany({
      where: { type: 'PASSWORD_RESET', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const match = pending.find((n) => {
      const payload = n.payload as { resetToken?: string } | null;
      return payload?.resetToken === dto.token;
    });

    if (!match) throw new UnauthorizedException('Invalid or already used reset token');

    const payload = match.payload as { expiresInMinutes?: number } | null;
    const expiresIn = payload?.expiresInMinutes ?? 30;
    if (match.createdAt.getTime() + expiresIn * 60_000 < Date.now()) {
      throw new UnauthorizedException('Reset token has expired');
    }

    const problems = SecurityService.assertPasswordStrength(dto.newPassword);
    if (problems.length) {
      throw new ForbiddenException({ message: 'Password is too weak', details: problems });
    }

    const admin = await this.prisma.admin.update({
      where: { id: match.adminId! },
      data: {
        passwordHash: await this.security.hashPassword(dto.newPassword),
        passwordChangedAt: new Date(),
        failedLogins: 0,
        lockedUntil: null,
      },
    });

    await this.prisma.notification.update({ where: { id: match.id }, data: { status: 'READ' } });
    await this.logoutAll(admin.id, 'PASSWORD_RESET');
    await this.audit.record(
      { action: 'auth.password_reset', entity: AuditEntity.ADMIN, entityId: admin.id },
      { id: admin.id, email: admin.email },
      req,
    );

    return { success: true };
  }

  // ------------------------------------------------------------------
  // Profile / sessions / 2FA
  // ------------------------------------------------------------------

  async profile(adminId: number): Promise<AuthAdminDto> {
    const admin = await this.prisma.admin.findUniqueOrThrow({
      where: { id: adminId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    return this.toAdminDto(admin);
  }

  /** Active sessions for the "manage sessions" screen. */
  async sessions(adminId: number) {
    const tokens = await this.prisma.refreshToken.findMany({
      where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
    });
    return { data: tokens };
  }

  async loginHistory(adminId: number, limit = 20) {
    const attempts = await this.prisma.loginAttempt.findMany({
      where: { adminId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return { data: attempts };
  }

  async enableTwoFactor(adminId: number, code: string) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (admin.twoFactorEnabled) throw new ForbiddenException('2FA is already enabled');

    const secret = this.security.generateTotpSecret();
    const encrypted = this.crypto.encryptSecret(
      secret,
      this.security.getEncryptionKey().toString('hex'),
    );

    // Verify the code before persisting, so we never store an unusable secret.
    if (!this.security.verifyTotp(secret, code)) {
      throw new ForbiddenException('Invalid verification code');
    }

    await this.prisma.admin.update({
      where: { id: adminId },
      data: { twoFactorEnabled: true, twoFactorSecretEnc: encrypted },
    });

    return { success: true };
  }

  async disableTwoFactor(adminId: number, code: string) {
    const admin = await this.prisma.admin.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.twoFactorEnabled || !admin.twoFactorSecretEnc) {
      throw new ForbiddenException('2FA is not enabled');
    }
    const secret = this.decryptTotp(admin.twoFactorSecretEnc);
    if (!secret || !this.security.verifyTotp(secret, code)) {
      throw new ForbiddenException('Invalid verification code');
    }
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null },
    });
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async issueTokens(
    adminId: number,
    email: string,
    name: string,
    roles: string[],
    permissions: string[],
    ip?: string,
    userAgent?: string | null,
    familyId?: string,
  ): Promise<AuthTokensDto> {
    const payload: JwtPayload = { sub: adminId, email, name, roles, perms: permissions, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload);

    const refreshToken = this.security.createOpaqueToken();
    const ttlDays = Number(this.config.get('JWT_REFRESH_TTL_DAYS', 30));
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        adminId,
        tokenHash: this.security.hashToken(refreshToken),
        familyId: familyId ?? this.security.createFamilyId(),
        ip: ip ?? null,
        userAgent: userAgent ?? null,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      tokenType: 'Bearer',
    };
  }

  private async registerFailure(admin: { id: number; failedLogins: number }): Promise<void> {
    const failedLogins = admin.failedLogins + 1;
    const shouldLock = failedLogins >= MAX_FAILED_LOGINS;
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: {
        failedLogins,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60_000) : null,
      },
    });
  }

  private permissionsOf(roles: RoleWithPermissions[]): string[] {
    const set = new Set<string>();
    for (const r of roles) for (const p of r.role.permissions) set.add(p.permission.key);
    return [...set];
  }

  private async logAttempt(
    adminId: number | null,
    email: string,
    success: boolean,
    reason: string | null,
    ip?: string,
    userAgent?: string | null,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: { adminId, email, success, reason, ip: ip ?? null, userAgent: userAgent ?? null },
    });
  }

  private toAdminDto(admin: {
    id: number;
    email: string;
    name: string;
    status: AdminStatus;
    locale: string;
    twoFactorEnabled: boolean;
    lastLoginAt: Date | null;
    roles: RoleWithPermissions[];
  }): AuthAdminDto {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      status: admin.status,
      locale: admin.locale,
      roles: admin.roles.map((r) => r.role.key) as AuthAdminDto['roles'],
      permissions: this.permissionsOf(admin.roles),
      twoFactorEnabled: admin.twoFactorEnabled,
      lastLoginAt: admin.lastLoginAt,
    };
  }

  private decryptTotp(encrypted: string | null): string | null {
    if (!encrypted) return null;
    try {
      return this.crypto.decryptSecret(encrypted, this.security.getEncryptionKey().toString('hex'));
    } catch {
      this.logger.error('Failed to decrypt 2FA secret');
      return null;
    }
  }

  // ---- Refresh cookie handling (token never exposed to page JavaScript) ----

  private setRefreshCookie(res: Response, token: string): void {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    res.cookie('owner_rt', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'strict' : 'lax',
      path: '/api/v1/auth',
      maxAge: Number(this.config.get('JWT_REFRESH_TTL_DAYS', 30)) * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie('owner_rt', { path: '/api/v1/auth' });
  }
}





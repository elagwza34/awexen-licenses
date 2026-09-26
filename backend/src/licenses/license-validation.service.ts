import { Injectable, Logger } from '@nestjs/common';
import { AuditEntity, DeviceStatus, LicenseStatus, ValidationStatus } from '@prisma/client';
import type { Request } from 'express';
import { AuditService } from '../common/audit/audit.service';
import { LicenseCryptoService, type LicensePayload } from '../common/crypto/license-crypto.service';
import { SecurityService } from '../common/crypto/security.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { normalizeLicenseKey } from './license-key.util';
import { LicenseStatusService } from './license-status.service';

export interface ValidateRequest {
  licenseKey: string;
  deviceFingerprint: string;
  deviceName?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface ValidateResponse {
  valid: boolean;
  status: ValidationStatus;
  message: string;
  /** How long the client may run offline before it must re-validate. */
  validUntil: string | null;
  payload: LicensePayload | null;
  signature: string | null;
  publicKey: string | null;
  serverTime: string;
  release: {
    latestVersion: string | null;
    minSupportedVersion: string | null;
    updateRequired: boolean;
    downloadUrl: string | null;
  } | null;
}

@Injectable()
export class LicenseValidationService {
  private readonly logger = new Logger(LicenseValidationService.name);
  /** Fallbacks until the settings table supplies real values. */
  private validationIntervalHours = 72;
  private gracePeriodDays = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: LicenseCryptoService,
    private readonly security: SecurityService,
    private readonly audit: AuditService,
    private readonly statusService: LicenseStatusService,
  ) {}

  setIntervals(validationIntervalHours: number, gracePeriodDays: number): void {
    this.validationIntervalHours = validationIntervalHours;
    this.gracePeriodDays = gracePeriodDays;
  }

  async refreshSettings(): Promise<void> {
    try {
      const rows = await this.prisma.setting.findMany({
        where: {
          key: {
            in: [
              'license.validation_interval_hours',
              'license.grace_period_days',
              'license.expiring_window_days',
            ],
          },
        },
      });
      for (const row of rows) {
        const value = Number(row.value);
        if (!Number.isFinite(value)) continue;
        if (row.key === 'license.validation_interval_hours') this.validationIntervalHours = value;
        if (row.key === 'license.grace_period_days') this.gracePeriodDays = value;
      }
      this.statusService.setFallbacks(this.gracePeriodDays, 14);
    } catch {
      this.logger.warn('Could not load validation settings — using fallbacks');
    }
  }

  /**
   * The endpoint the customer application calls periodically.
   * Every outcome — success or failure — is recorded in license_validations.
   */
  async validate(input: ValidateRequest, req: Request): Promise<ValidateResponse> {
    const startedAt = Date.now();
    const ip = req.ip;
    const licenseKey = normalizeLicenseKey(input.licenseKey);
    // Fingerprints are salted+peppered server-side, never stored raw.
    const fingerprint = this.security.hashFingerprint([input.deviceFingerprint]);

    const license = await this.prisma.license.findUnique({
      where: { licenseKey },
      include: { plan: { include: { features: { include: { feature: true } } } } },
    });

    const record = (data: {
      licenseId: number;
      customerId: number;
      deviceId?: number;
      status: ValidationStatus;
      reason: string;
      validUntil?: Date | null;
    }) =>
      this.prisma.licenseValidation.create({
        data: {
          licenseId: data.licenseId,
          customerId: data.customerId,
          deviceId: data.deviceId ?? null,
          status: data.status,
          reason: data.reason,
          ip: ip ?? null,
          appVersion: input.appVersion ?? null,
          latencyMs: Date.now() - startedAt,
          validUntil: data.validUntil ?? null,
        },
      });

    const fail = async (
      status: ValidationStatus,
      message: string,
      ctx?: { licenseId: number; customerId: number; deviceId?: number },
    ): Promise<ValidateResponse> => {
      if (ctx) {
        await record({
          licenseId: ctx.licenseId,
          customerId: ctx.customerId,
          deviceId: ctx.deviceId,
          status,
          reason: message,
        });
      }
      return this.buildResponse(false, status, message);
    };

    if (!license) {
      return fail(ValidationStatus.INVALID, 'License key not found');
    }

    // ---- License-level checks ------------------------------------------

    if (license.status === LicenseStatus.REVOKED) {
      return fail(ValidationStatus.REVOKED, 'License has been revoked', {
        licenseId: license.id,
        customerId: license.customerId,
      });
    }
    if (license.status === LicenseStatus.SUSPENDED) {
      return fail(ValidationStatus.SUSPENDED, 'License is suspended', {
        licenseId: license.id,
        customerId: license.customerId,
      });
    }

    // Server-side status derivation is authoritative (business rule 12).
    const derived = this.statusService.derive(license);
    if (derived.status === LicenseStatus.EXPIRED) {
      return fail(ValidationStatus.EXPIRED, 'License has expired', {
        licenseId: license.id,
        customerId: license.customerId,
      });
    }

    // ---- Device-level checks -------------------------------------------

    const existingDevice = await this.prisma.device.findUnique({
      where: { licenseId_deviceFingerprint: { licenseId: license.id, deviceFingerprint: fingerprint } },
    });

    if (existingDevice?.status === DeviceStatus.REVOKED) {
      return fail(ValidationStatus.REVOKED, 'This device has been revoked', {
        licenseId: license.id,
        customerId: license.customerId,
        deviceId: existingDevice.id,
      });
    }
    if (existingDevice?.status === DeviceStatus.BLOCKED) {
      return fail(ValidationStatus.FAILED, 'This device has been blocked', {
        licenseId: license.id,
        customerId: license.customerId,
        deviceId: existingDevice.id,
      });
    }

    let deviceId = existingDevice?.id;

    if (!existingDevice) {
      // Enforce the device limit server-side; the client can never widen it.
      const activeDevices = await this.prisma.device.count({
        where: { licenseId: license.id, status: DeviceStatus.ACTIVE },
      });
      if (activeDevices >= license.maxDevices) {
        return fail(ValidationStatus.DEVICE_LIMIT, `Device limit reached (${license.maxDevices} devices)`, {
          licenseId: license.id,
          customerId: license.customerId,
        });
      }
      const created = await this.prisma.device.create({
        data: {
          licenseId: license.id,
          deviceFingerprint: fingerprint,
          deviceName: input.deviceName ?? null,
          platform: input.platform ?? null,
          osVersion: input.osVersion ?? null,
          appVersion: input.appVersion ?? null,
          status: DeviceStatus.ACTIVE,
          lastIp: ip ?? null,
          lastSeenAt: new Date(),
          lastValidationAt: new Date(),
        },
      });
      deviceId = created.id;
    } else {
      await this.prisma.device.update({
        where: { id: existingDevice.id },
        data: {
          lastSeenAt: new Date(),
          lastValidationAt: new Date(),
          lastIp: ip ?? null,
          appVersion: input.appVersion ?? existingDevice.appVersion,
          osVersion: input.osVersion ?? existingDevice.osVersion,
        },
      });
    }

    // ---- Success ---------------------------------------------------------

    // The client may run offline for the validation interval, capped by the
    // license expiry itself.
    const intervalMs = this.validationIntervalHours * 3_600_000;
    const licenceBound = license.expiresAt
      ? Math.min(license.expiresAt.getTime(), Date.now() + intervalMs)
      : Date.now() + intervalMs;
    const validUntil = new Date(licenceBound);

    const payload: LicensePayload = {
      licenseKey: license.licenseKey,
      planKey: license.plan.key,
      edition: license.plan.name,
      features: license.plan.features.map((pf) => pf.feature.key).sort(),
      maxDevices: license.maxDevices,
      issuedAt: license.createdAt.toISOString(),
      expiresAt: license.expiresAt ? license.expiresAt.toISOString() : null,
      version: license.version,
    };

    // Sign on demand so the payload always matches the live row.
    const signed = this.crypto.sign(payload);

    await this.prisma.$transaction([
      record({
        licenseId: license.id,
        customerId: license.customerId,
        deviceId: deviceId ?? undefined,
        status: ValidationStatus.SUCCESS,
        reason: derived.reason ?? 'Validated',
        validUntil,
      }),
      this.prisma.license.update({
        where: { id: license.id },
        data: {
          lastValidationAt: new Date(),
          lastSeenAt: new Date(),
          signature: signed.signature,
          payloadHash: signed.payloadHash,
        },
      }),
    ]);

    const release = await this.resolveRelease(input.appVersion, input.platform);

    return {
      valid: true,
      status: ValidationStatus.SUCCESS,
      message: derived.reason ?? 'License is valid',
      validUntil: validUntil.toISOString(),
      payload,
      signature: signed.signature,
      publicKey: this.crypto.getPublicKeyPem(),
      serverTime: new Date().toISOString(),
      release,
    };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async buildResponse(
    valid: boolean,
    status: ValidationStatus,
    message: string,
    validUntil: Date | null = null,
  ): Promise<ValidateResponse> {
    return {
      valid,
      status,
      message,
      validUntil: validUntil ? validUntil.toISOString() : null,
      // No payload on failure: a blocked client learns nothing about its
      // entitlements.
      payload: null,
      signature: null,
      publicKey: valid ? this.crypto.getPublicKeyPem() : null,
      serverTime: new Date().toISOString(),
      release: null,
    };
  }

  /**
   * Version check piggybacks on validation. Automatic updates are explicitly
   * out of scope — we only report what the admin published.
   */
  private async resolveRelease(appVersion?: string, platform?: string) {
    const latest = await this.prisma.appVersion.findFirst({
      where: {
        status: 'PUBLISHED',
        ...(platform ? { platform: platform.toUpperCase() as any } : {}),
      },
      orderBy: [{ version: 'desc' }, { buildNumber: 'desc' }],
    });

    if (!latest) return null;

    // Semantic comparison on dot-separated numeric parts.
    const required = latest.isRequired && latest.minSupportedVersion
      ? compareVersions(appVersion ?? '0.0.0', latest.minSupportedVersion) < 0
      : Boolean(latest.isRequired) && compareVersions(appVersion ?? '0.0.0', latest.version) < 0;

    return {
      latestVersion: latest.version,
      minSupportedVersion: latest.minSupportedVersion,
      updateRequired: required,
      downloadUrl: latest.downloadUrl,
    };
  }

  /** Recent validations for the owner panel. */
  async history(query: { licenseId?: number; status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);
    const where = {
      ...(query.licenseId ? { licenseId: query.licenseId } : {}),
      ...(query.status ? { status: query.status as ValidationStatus } : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.licenseValidation.count({ where }),
      this.prisma.licenseValidation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          license: { select: { id: true, licenseKey: true } },
          customer: { select: { id: true, name: true, company: true } },
          device: { select: { id: true, deviceName: true } },
        },
      }),
    ]);

    return { data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }
}

/** "1.10.0" > "1.9.0" — numeric segment comparison, not lexicographic. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}




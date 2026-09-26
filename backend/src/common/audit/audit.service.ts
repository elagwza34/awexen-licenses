import { Injectable } from '@nestjs/common';
import { AuditEntity, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditActor {
  id: number;
  email: string;
}

export interface AuditEntry {
  action: string;
  entity: AuditEntity;
  entityId?: string | number | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
  /**
   * Pass a Prisma transaction client so the audit row is written atomically with
   * the business change. This is the default in services.
   */
  tx?: Prisma.TransactionClient;
}

/** Fields that must never be persisted into the audit trail. */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'currentPassword',
  'newPassword',
  'twoFactorSecretEnc',
  'tokenHash',
  'refreshToken',
  'licensePrivateKey',
  'signature',
]);

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_FIELDS.has(k)) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'bigint') {
        out[k] = v.toString();
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one append-only audit row.
   * Never throws — an audit failure must not roll back a committed business
   * change, but it is logged loudly.
   */
  async record(entry: AuditEntry, actor?: AuditActor, req?: Request): Promise<void> {
    const client = entry.tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          adminId: actor?.id ?? null,
          adminEmail: actor?.email ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId != null ? String(entry.entityId) : null,
          oldValue: (sanitize(entry.oldValue) ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (sanitize(entry.newValue) ?? undefined) as Prisma.InputJsonValue | undefined,
          metadata: (sanitize(entry.metadata) ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: req?.ip ?? null,
          userAgent: req?.headers?.['user-agent']?.toString().slice(0, 400) ?? null,
          requestId: (req as (Request & { requestId?: string }) | undefined)?.requestId ?? null,
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[AUDIT] Failed to write audit log', { entry, error });
    }
  }

  /** Convenience for batched writes inside one transaction. */
  build(entries: AuditEntry[], actor?: AuditActor, req?: Request): Prisma.AuditLogCreateManyInput[] {
    return entries.map((entry) => ({
      adminId: actor?.id ?? null,
      adminEmail: actor?.email ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId != null ? String(entry.entityId) : null,
      oldValue: (sanitize(entry.oldValue) ?? undefined) as Prisma.InputJsonValue | undefined,
      newValue: (sanitize(entry.newValue) ?? undefined) as Prisma.InputJsonValue | undefined,
      metadata: (sanitize(entry.metadata) ?? undefined) as Prisma.InputJsonValue | undefined,
      ip: req?.ip ?? null,
      userAgent: req?.headers?.['user-agent']?.toString().slice(0, 400) ?? null,
      createdAt: new Date(),
    }));
  }
}

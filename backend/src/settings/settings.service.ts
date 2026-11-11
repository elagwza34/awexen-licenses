import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditEntity, SettingType } from '@prisma/client';
import { ArrayMinSize, IsArray, IsBoolean, IsDefined, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { AuditService, type AuditActor } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { LicenseStatusService } from '../licenses/license-status.service';
import { LicenseValidationService } from '../licenses/license-validation.service';

export class UpdateSettingDto {
  @ApiProperty() @IsDefined() value!: string | number | boolean | object;

  @ApiPropertyOptional() @IsOptional() @IsString()
  label?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  labelAr?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  group?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isSensitive?: boolean;
}

export class SettingUpdateItemDto extends UpdateSettingDto {
  @IsString() @IsNotEmpty() key!: string;
}

export class BulkUpdateSettingsDto {
  @ApiProperty({ type: [SettingUpdateItemDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SettingUpdateItemDto)
  settings!: SettingUpdateItemDto[];
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly statusService: LicenseStatusService,
    private readonly validationService: LicenseValidationService,
  ) {}

  async findAll(group?: string) {
    const settings = await this.prisma.setting.findMany({
      where: group ? { group } : undefined,
      orderBy: [{ group: 'asc' }, { key: 'asc' }],
    });

    return {
      data: settings.map((setting) => ({
        ...setting,
        // Sensitive values are never returned in full — only whether one is set.
        value: setting.isSensitive ? '[HIDDEN]' : setting.value,
      })),
    };
  }

  async findOne(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException('Setting not found');
    return { ...setting, value: setting.isSensitive ? '[HIDDEN]' : setting.value };
  }

  async update(key: string, dto: UpdateSettingDto, actor: AuditActor, req: Request) {
    const existing = await this.prisma.setting.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException('Setting not found');

    // Business rule: sensitive settings require explicit confirmation.
    if (existing.isSensitive && !dto.isSensitive) {
      throw new ForbiddenException('This setting is sensitive and requires an explicit confirmation flag');
    }

    const value = this.coerce(existing.type, dto.value, key);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.setting.update({
        where: { key },
        data: {
          value: value as any,
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.labelAr !== undefined ? { labelAr: dto.labelAr } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.group !== undefined ? { group: dto.group } : {}),
          updatedById: actor.id,
        },
      });

      await this.audit.record(
        {
          action: 'setting.updated',
          entity: AuditEntity.SETTING,
          entityId: key,
          oldValue: { value: existing.isSensitive ? '[HIDDEN]' : existing.value },
          newValue: { value: existing.isSensitive ? '[HIDDEN]' : value },
          tx,
        },
        actor,
        req,
      );

      return result;
    });

    // Business rules that live in settings take effect immediately.
    await this.applyRuntimeSettings();

    return { ...updated, value: existing.isSensitive ? '[HIDDEN]' : updated.value };
  }

  async bulkUpdate(dto: BulkUpdateSettingsDto, actor: AuditActor, req: Request) {
    const results = [];
    for (const setting of dto.settings) {
      const { key, ...rest } = setting;
      results.push(await this.update(key, rest, actor, req));
    }
    return { updated: results.length, data: results };
  }

  /**
   * Pushes the tunables the licensing engine actually reads into the services,
   * so a settings change takes effect without a restart.
   */
  async applyRuntimeSettings(): Promise<void> {
    await Promise.all([
      this.statusService.refreshSettings(),
      this.validationService.refreshSettings(),
    ]);
  }

  /** Validates and normalises a value against the declared type. */
  private coerce(type: SettingType, value: unknown, key: string): string | number | boolean | object {
    switch (type) {
      case SettingType.NUMBER: {
        if (typeof value !== 'number' && !(typeof value === 'string' && value.trim() !== ''))
          throw new BadRequestException(`${key} must be a number`);
        const num = Number(value);
        if (!Number.isFinite(num)) throw new BadRequestException(`${key} must be a number`);
        if (num < 0) throw new BadRequestException(`${key} cannot be negative`);
        return num;
      }
      case SettingType.BOOLEAN:
        if (typeof value === 'boolean') return value;
        if (value === 'true' || value === 'false') return value === 'true';
        throw new BadRequestException(`${key} must be a boolean`);
      case SettingType.STRING:
        if (typeof value !== 'string') throw new BadRequestException(`${key} must be a string`);
        return value;
      case SettingType.JSON:
        return value as object;
      default:
        return value as string;
    }
  }
}

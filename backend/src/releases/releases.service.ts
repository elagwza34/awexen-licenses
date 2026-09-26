import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppVersionStatus, Platform, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request } from 'express';
import { type AuditActor } from '../common/audit/audit.service';
import { paginated, type PaginatedResponse, type PaginationQueryDto } from '../common/dto/pagination.dto';
import { PrismaService } from '../common/prisma/prisma.service';

export class CreateVersionDto {
  @ApiProperty({ example: '1.2.0' })
  @IsString()
  @Matches(/^\d+(\.\d+){0,3}$/, { message: 'Version must be numeric, e.g. 1.2.0' })
  @MaxLength(40)
  version!: string;

  @ApiProperty() @Type(() => Number) @IsInt() @Min(0)
  buildNumber!: number;

  @ApiPropertyOptional({ enum: Platform, default: Platform.WINDOWS })
  @IsOptional() @IsEnum(Platform)
  platform?: Platform;

  @ApiPropertyOptional({ default: 'stable' })
  @IsOptional() @IsString() @MaxLength(40)
  channel?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20000)
  releaseNotes?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500)
  downloadUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128)
  checksum?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  fileSize?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Clients below this version must update' })
  @IsOptional() @IsString() @MaxLength(40)
  minSupportedVersion?: string;
}

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: PaginationQueryDto & Record<string, any>): Promise<PaginatedResponse<any>> {
    const where: Prisma.AppVersionWhereInput = {};
    if (query.status) where.status = query.status as AppVersionStatus;
    if (query.platform) where.platform = query.platform as Platform;
    if (query.channel) where.channel = query.channel;
    if (query.search) {
      where.OR = [
        { version: { contains: query.search } },
        { releaseNotes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.appVersion.count({ where }),
      this.prisma.appVersion.findMany({
        where,
        skip: query.skip,
        take: query.take,
        // Highest build first — the newest release should always sit at the top.
        orderBy: [{ version: 'desc' }, { buildNumber: 'desc' }],
      }),
    ]);

    return paginated(rows, total, query.page, query.limit);
  }

  async findOne(id: number) {
    const version = await this.prisma.appVersion.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  async create(dto: CreateVersionDto, actor: AuditActor, req: Request) {
    const platform = dto.platform ?? Platform.WINDOWS;
    const channel = dto.channel ?? 'stable';

    const clash = await this.prisma.appVersion.findFirst({
      where: { version: dto.version, buildNumber: dto.buildNumber, platform, channel },
    });
    if (clash) {
      throw new ConflictException(
        `Version ${dto.version} (build ${dto.buildNumber}) already exists for this platform and channel`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // A new release always starts as a draft; publishing is a separate,
      // separately-audited decision.
      const version = await tx.appVersion.create({
        data: { ...dto, platform, channel, status: AppVersionStatus.DRAFT },
      });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'release.created',
          entity: 'APP_VERSION',
          entityId: String(version.id),
          newValue: {
            version: version.version,
            buildNumber: version.buildNumber,
            platform: version.platform,
          },
          ip: req.ip ?? null,
        },
      });
      return version;
    });
  }

  /**
   * Publish a release. Previously published versions on the same platform and
   * channel become DEPRECATED so clients are steered to exactly one current build.
   */
  async publish(id: number, actor: AuditActor, req: Request) {
    const version = await this.prisma.appVersion.findUniqueOrThrow({ where: { id } });

    if (version.status === AppVersionStatus.PUBLISHED) {
      throw new ConflictException('Version is already published');
    }
    if (version.status === AppVersionStatus.DEPRECATED) {
      throw new BadRequestException('A deprecated version cannot be published again');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.appVersion.updateMany({
        where: {
          platform: version.platform,
          channel: version.channel,
          status: AppVersionStatus.PUBLISHED,
          id: { not: id },
        },
        data: { status: AppVersionStatus.DEPRECATED },
      });

      await tx.appVersion.update({
        where: { id },
        data: { status: AppVersionStatus.PUBLISHED, releasedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'release.published',
          entity: 'APP_VERSION',
          entityId: String(id),
          oldValue: { status: version.status },
          newValue: { status: AppVersionStatus.PUBLISHED, version: version.version },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  async deprecate(id: number, actor: AuditActor, req: Request) {
    const version = await this.prisma.appVersion.findUniqueOrThrow({ where: { id } });
    if (version.status === AppVersionStatus.DEPRECATED) return this.findOne(id);

    // Never leave a platform with no published build.
    const others = await this.prisma.appVersion.count({
      where: {
        platform: version.platform,
        channel: version.channel,
        status: AppVersionStatus.PUBLISHED,
        id: { not: id },
      },
    });
    if (others === 0) {
      throw new BadRequestException(
        'Publish another version first — a platform must always have a current build',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.appVersion.update({ where: { id }, data: { status: AppVersionStatus.DEPRECATED } });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'release.deprecated',
          entity: 'APP_VERSION',
          entityId: String(id),
          oldValue: { status: version.status },
          newValue: { status: AppVersionStatus.DEPRECATED },
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  async update(id: number, dto: Partial<CreateVersionDto>, actor: AuditActor, req: Request) {
    const existing = await this.prisma.appVersion.findUniqueOrThrow({ where: { id } });

    // A published build's URL is what customers actually download.
    if (existing.status === AppVersionStatus.PUBLISHED && dto.downloadUrl) {
      throw new ConflictException(
        'A published version cannot have its download URL changed — publish a new build instead',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.appVersion.update({ where: { id }, data: dto });
      await tx.auditLog.create({
        data: {
          adminId: actor.id,
          adminEmail: actor.email,
          action: 'release.updated',
          entity: 'APP_VERSION',
          entityId: String(id),
          // fileSize is a BigInt and JSON has no BigInt type, so it is
          // stringified before being written to the audit snapshot.
          oldValue: { ...existing, fileSize: existing.fileSize?.toString() ?? null },
          newValue: dto,
          ip: req.ip ?? null,
        },
      });
    });

    return this.findOne(id);
  }

  /**
   * What the customer application sees when it checks for updates.
   * Reports only — it never downloads or executes anything.
   */
  async latestFor(platform: string) {
    const latest = await this.prisma.appVersion.findFirst({
      where: { status: AppVersionStatus.PUBLISHED, platform: platform.toUpperCase() as Platform },
      orderBy: [{ version: 'desc' }, { buildNumber: 'desc' }],
    });

    if (!latest) return { data: null };

    return {
      data: {
        version: latest.version,
        buildNumber: latest.buildNumber,
        platform: latest.platform,
        releasedAt: latest.releasedAt,
        downloadUrl: latest.downloadUrl,
        isRequired: latest.isRequired,
        minSupportedVersion: latest.minSupportedVersion,
        releaseNotes: latest.releaseNotes,
      },
    };
  }
}
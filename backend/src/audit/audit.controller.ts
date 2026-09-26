import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditEntity, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditEntity })
  @IsOptional() @IsEnum(AuditEntity)
  entity?: AuditEntity;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120)
  action?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt()
  adminId?: number;
}

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Search the audit trail' })
  async findAll(@Query() query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.adminId) where.adminId = query.adminId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.search) {
      where.OR = [
        { action: { contains: query.search, mode: 'insensitive' } },
        { adminEmail: { contains: query.search, mode: 'insensitive' } },
        { entityId: { contains: query.search } },
      ];
    }

    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip: query.skip,
        take: query.take,
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
    ]);

    return {
      data: rows,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  @Get('actions')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Distinct actions present in the audit trail (for filter dropdowns)' })
  async actions() {
    const rows = await this.prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } });
    return {
      data: rows
        .map((r) => ({ action: r.action, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    };
  }

  @Get('entity/:entity/:id')
  @RequirePermissions('audit.view')
  @ApiOperation({ summary: 'Full history for one record' })
  async forEntity(
    @Param('entity') entity: AuditEntity,
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    const rows = await this.prisma.auditLog.findMany({
      where: { entity, entityId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      include: { admin: { select: { id: true, name: true } } },
    });
    return { data: rows };
  }
}

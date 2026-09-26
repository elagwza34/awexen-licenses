import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentAdmin, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { SupportService } from './support.service';

export class CreateTicketDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1)
  customerId!: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  licenseId?: number;

  @ApiProperty() @IsString() @MinLength(3) @MaxLength(300)
  subject!: string;

  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000)
  message!: string;

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptional() @IsEnum(TicketPriority)
  priority?: TicketPriority;
}

export class ReplyTicketDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;

  @ApiPropertyOptional({ enum: ['REPLY', 'INTERNAL_NOTE'], default: 'REPLY' })
  @IsOptional() @IsEnum(['REPLY', 'INTERNAL_NOTE'] as unknown as object)
  type?: 'REPLY' | 'INTERNAL_NOTE';
}

export class TicketStatusDto {
  @ApiProperty({ enum: TicketStatus })
  @IsEnum(TicketStatus)
  status!: TicketStatus;
}

export class AssignTicketDto {
  @ApiPropertyOptional({ description: 'Admin id, or null to unassign' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  adminId?: number | null;
}

@ApiTags('Support')
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @RequirePermissions('support.view')
  @ApiOperation({ summary: 'List tickets' })
  findAll(@Query() query: PaginationQueryDto & Record<string, any>) {
    return this.support.findAll(query);
  }

  @Get('summary')
  @RequirePermissions('support.view')
  @ApiOperation({ summary: 'Ticket counts by status' })
  summary() {
    return this.support.summary();
  }

  @Get(':id')
  @RequirePermissions('support.view')
  @ApiOperation({ summary: 'Ticket detail with its message thread' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.support.findOne(id);
  }

  @Post()
  @RequirePermissions('support.update')
  @ApiOperation({ summary: 'Open a ticket' })
  create(@Body() dto: CreateTicketDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.support.create(dto, admin, req);
  }

  @Post(':id/reply')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support.update')
  @ApiOperation({ summary: 'Reply to a ticket or add an internal note' })
  reply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyTicketDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.support.reply(id, dto.body, dto.type ?? 'INTERNAL_NOTE', admin, req);
  }

  @Post(':id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support.update')
  @ApiOperation({ summary: 'Change ticket status' })
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketStatusDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.support.updateStatus(id, dto.status, admin, req);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('support.update')
  @ApiOperation({ summary: 'Assign or unassign a ticket' })
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTicketDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.support.assign(id, dto.adminId ?? null, admin, req);
  }
}

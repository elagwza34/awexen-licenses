import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { OmitType, PartialType } from "@nestjs/swagger";
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";
import { Transform } from "class-transformer";
import { AuditEntity } from "@prisma/client";
import {
  CurrentAdmin,
  RequirePermissions,
  type AuthAdmin,
} from "../common/decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";

class CreateSystemDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,59}$/) key!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  name!: string;
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 120)
  nameAr!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateSystemDto extends PartialType(
  OmitType(CreateSystemDto, ["key"] as const),
) {}

@Controller("systems")
export class SystemsController {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}
  @Get()
  @RequirePermissions("plans.view")
  async list() {
    return {
      data: await this.db.softwareSystem.findMany({
        orderBy: { id: "asc" },
        include: { _count: { select: { plans: true } } },
      }),
    };
  }
  @Post()
  @RequirePermissions("plans.create")
  create(
    @Body() body: CreateSystemDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.db.$transaction(async (tx) => {
      const row = await tx.softwareSystem.create({ data: body });
      await this.audit.record(
        {
          action: "software_system.created",
          entity: AuditEntity.PLAN,
          entityId: row.id,
          newValue: row,
          tx,
        },
        admin,
        req,
      );
      return row;
    });
  }
  @Put(":id")
  @RequirePermissions("plans.update")
  update(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: UpdateSystemDto,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.db.$transaction(async (tx) => {
      const before = await tx.softwareSystem.findUniqueOrThrow({
        where: { id },
      });
      const row = await tx.softwareSystem.update({ where: { id }, data: body });
      await this.audit.record(
        {
          action: "software_system.updated",
          entity: AuditEntity.PLAN,
          entityId: id,
          oldValue: before,
          newValue: row,
          tx,
        },
        admin,
        req,
      );
      return row;
    });
  }
}

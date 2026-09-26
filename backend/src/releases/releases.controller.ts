import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { CurrentAdmin, Public, RequirePermissions, type AuthAdmin } from '../common/decorators';
import { CreateVersionDto, ReleasesService } from './releases.service';

@ApiTags('Releases')
@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @RequirePermissions('releases.view')
  @ApiOperation({ summary: 'List application versions, newest first' })
  findAll(@Query() query: PaginationQueryDto & Record<string, any>) {
    return this.releases.findAll(query);
  }

  @Get('latest')
  // Public on purpose: the customer application calls this before anyone has
  // signed in. It only reports a version number and a download URL — it never
  // downloads or executes anything — and the owner's licence check remains the
  // thing that actually grants permission to run.
  @Public()
  @ApiOperation({
    summary: 'Latest published build for a platform (used by the customer app)',
    description:
      'Reports only. This endpoint never downloads or executes anything. The ' +
      'installed app calls it to decide whether to show "a newer version is available".',
  })
  latest(
    @Query('platform') platform = 'WINDOWS',
    @Query('channel') channel = 'stable',
  ) {
    return this.releases.latestFor(platform, channel);
  }

  @Get(':id')
  @RequirePermissions('releases.view')
  @ApiOperation({ summary: 'Version detail' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.releases.findOne(id);
  }

  @Post()
  @RequirePermissions('releases.create')
  @ApiOperation({ summary: 'Create a draft release' })
  create(@Body() dto: CreateVersionDto, @CurrentAdmin() admin: AuthAdmin, @Req() req: any) {
    return this.releases.create(dto, admin, req);
  }

  @Put(':id')
  @RequirePermissions('releases.create')
  @ApiOperation({ summary: 'Update a release' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateVersionDto>,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.releases.update(id, dto, admin, req);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('releases.publish')
  @ApiOperation({ summary: 'Publish a release, deprecating the previous build' })
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.releases.publish(id, admin, req);
  }

  @Post(':id/deprecate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('releases.publish')
  @ApiOperation({ summary: 'Deprecate a published release' })
  deprecate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentAdmin() admin: AuthAdmin,
    @Req() req: any,
  ) {
    return this.releases.deprecate(id, admin, req);
  }
}

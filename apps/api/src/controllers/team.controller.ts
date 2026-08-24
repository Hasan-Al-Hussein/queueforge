import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AdminService, OperationsService } from '@queueforge/application';
import { PageQuerySchema } from '@queueforge/contracts';
import type { JsonObject, PageQuery as PageQueryInput, TenantContext } from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey, toPage, type PageEnvelope } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CreateMembershipDto, CreateTenantDto, UpdateMembershipRoleDto } from '../dto.js';
import {
  ApiIdempotencyKey,
  ApiPageParameters,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import { pageSchema, TEAM_MEMBER_SCHEMA, TENANT_SCHEMA } from '../openapi/schemas.js';

@ApiTags('platform administration')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('tenants')
export class TenantAdminController {
  public constructor(private readonly admin: AdminService) {}

  @Post()
  @ApiOperation({ summary: 'Create a tenant and add the platform administrator' })
  @ApiBody({ type: CreateTenantDto })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Created tenant and administrator membership.',
    schema: TENANT_SCHEMA,
  })
  public create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateTenantDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<AdminService['createTenant']> {
    return this.admin.createTenant(
      context,
      input,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }
}

@ApiTags('team')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('team/memberships')
export class TeamController {
  public constructor(
    private readonly admin: AdminService,
    private readonly operations: OperationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List tenant members and roles' })
  @ApiPageParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of tenant members and roles.',
    schema: pageSchema(TEAM_MEMBER_SCHEMA),
  })
  public async list(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQueryInput,
  ): Promise<PageEnvelope<JsonObject>> {
    const result = await this.operations.team(context, page.page, page.pageSize);
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Post()
  @ApiOperation({ summary: 'Add an existing user or create a local user and membership' })
  @ApiBody({ type: CreateMembershipDto })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Created tenant membership.',
    schema: TEAM_MEMBER_SCHEMA,
  })
  public create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateMembershipDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<AdminService['createMembership']> {
    return this.admin.createMembership(
      context,
      input,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change a tenant member role' })
  @ApiBody({ type: UpdateMembershipRoleDto })
  @ApiQueueForgeJsonResponse({
    description: 'Updated tenant membership.',
    schema: TEAM_MEMBER_SCHEMA,
  })
  public update(
    @CurrentTenant() context: TenantContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: UpdateMembershipRoleDto,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<OperationsService['updateMembership']> {
    return this.operations.updateMembership(context, userId, input.role, correlationId);
  }
}

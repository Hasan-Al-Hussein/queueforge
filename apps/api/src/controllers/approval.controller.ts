import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApprovalService } from '@queueforge/application';
import { ApprovalDecisionInputSchema, PageQuerySchema } from '@queueforge/contracts';
import type {
  ApprovalDecisionInput,
  JsonObject,
  PageQuery as PageQueryInput,
  TenantContext,
} from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey, toPage, type PageEnvelope } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiIdempotencyKey,
  ApiJsonBody,
  ApiPageParameters,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import {
  APPROVAL_DECISION_BODY_SCHEMA,
  APPROVAL_DECISION_SCHEMA,
  APPROVAL_TASK_SCHEMA,
  pageSchema,
} from '../openapi/schemas.js';

@ApiTags('approvals')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('approvals')
export class ApprovalController {
  public constructor(private readonly approvals: ApprovalService) {}

  @Get()
  @ApiOperation({ summary: 'List approval tasks visible to the selected tenant' })
  @ApiPageParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of tenant approval tasks.',
    schema: pageSchema(APPROVAL_TASK_SCHEMA),
  })
  public async list(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQueryInput,
  ): Promise<PageEnvelope<JsonObject>> {
    const result = await this.approvals.list(context, page.page, page.pageSize);
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Post(':approvalId/decide')
  @ApiOperation({ summary: 'Approve or reject a pending task with optimistic concurrency' })
  @ApiJsonBody(
    APPROVAL_DECISION_BODY_SCHEMA,
    'Decision, optional note, and the exact approval revision being decided.',
  )
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Recorded approval decision and resulting request status.',
    schema: APPROVAL_DECISION_SCHEMA,
  })
  public decide(
    @CurrentTenant() context: TenantContext,
    @Param('approvalId', new ParseUUIDPipe()) approvalId: string,
    @Body(new ZodValidationPipe(ApprovalDecisionInputSchema)) input: ApprovalDecisionInput,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<ApprovalService['decide']> {
    return this.approvals.decide(
      context,
      approvalId,
      correlationId,
      input,
      requireIdempotencyKey(idempotencyKey),
    );
  }
}

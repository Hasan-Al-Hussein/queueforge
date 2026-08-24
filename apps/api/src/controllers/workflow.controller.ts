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
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { WorkflowService } from '@queueforge/application';
import { DraftAutosaveInputSchema } from '@queueforge/contracts';
import type { DraftAutosaveInput, TenantContext } from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CreateWorkflowDto } from '../dto.js';
import {
  ApiIdempotencyKey,
  ApiJsonBody,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import {
  arraySchema,
  DRAFT_AUTOSAVE_BODY_SCHEMA,
  WORKFLOW_DRAFT_SCHEMA,
  WORKFLOW_SUMMARY_SCHEMA,
} from '../openapi/schemas.js';

@ApiTags('workflows')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('workflows')
export class WorkflowController {
  public constructor(private readonly workflows: WorkflowService) {}

  @Get()
  @ApiOperation({ summary: 'List current workflow versions in the selected tenant' })
  @ApiQueueForgeJsonResponse({
    description: 'Current workflow version summaries in the selected tenant.',
    schema: arraySchema(WORKFLOW_SUMMARY_SCHEMA),
  })
  public list(@CurrentTenant() context: TenantContext): ReturnType<WorkflowService['list']> {
    return this.workflows.list(context);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new workflow with an editable first draft' })
  @ApiBody({ type: CreateWorkflowDto })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'New editable workflow draft.',
    schema: WORKFLOW_DRAFT_SCHEMA,
  })
  public create(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateWorkflowDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WorkflowService['create']> {
    return this.workflows.create(
      context,
      {
        stableKey: input.stableKey,
        name: input.name,
        ...(input.description === undefined || input.description === null
          ? {}
          : { description: input.description }),
      },
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }

  @Get(':workflowId')
  @ApiOperation({ summary: 'Get the current draft or active immutable workflow version' })
  @ApiQueueForgeJsonResponse({
    description: 'Current workflow draft or active version with processing configuration.',
    schema: WORKFLOW_DRAFT_SCHEMA,
  })
  public get(
    @CurrentTenant() context: TenantContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
  ): ReturnType<WorkflowService['get']> {
    return this.workflows.get(context, workflowId);
  }

  @Patch(':workflowId/draft')
  @ApiOperation({ summary: 'Autosave a draft with an expected revision' })
  @ApiJsonBody(DRAFT_AUTOSAVE_BODY_SCHEMA, 'Complete draft snapshot and expected revision.')
  @ApiQueueForgeJsonResponse({
    description: 'Saved workflow draft with the incremented revision.',
    schema: WORKFLOW_DRAFT_SCHEMA,
  })
  public saveDraft(
    @CurrentTenant() context: TenantContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
    @Body(new ZodValidationPipe(DraftAutosaveInputSchema)) input: DraftAutosaveInput,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WorkflowService['saveDraft']> {
    return this.workflows.saveDraft(context, workflowId, correlationId, input);
  }

  @Post(':workflowId/clone-draft')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Clone the active immutable version into a new editable draft' })
  @ApiQueueForgeJsonResponse({
    description: 'New editable draft cloned from the active version.',
    schema: WORKFLOW_DRAFT_SCHEMA,
  })
  public cloneDraft(
    @CurrentTenant() context: TenantContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
  ): ReturnType<WorkflowService['cloneDraft']> {
    return this.workflows.cloneDraft(context, workflowId);
  }

  @Post(':workflowId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a draft and retire the prior immutable version' })
  @ApiQueueForgeJsonResponse({
    description: 'Activated immutable workflow version.',
    schema: WORKFLOW_DRAFT_SCHEMA,
  })
  public activate(
    @CurrentTenant() context: TenantContext,
    @Param('workflowId', new ParseUUIDPipe()) workflowId: string,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WorkflowService['activate']> {
    return this.workflows.activate(context, workflowId, correlationId);
  }
}

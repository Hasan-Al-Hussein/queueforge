import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';

import { ApplicationError, OperationsService, RequestService } from '@queueforge/application';
import { RequestListQuerySchema, SubmitWorkflowRequestSchema } from '@queueforge/contracts';
import type {
  RequestListQuery,
  SubmitWorkflowRequest,
  TenantContext,
  WorkflowRequestView,
} from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { requireIdempotencyKey, toPage, type PageEnvelope } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  ApiIdempotencyKey,
  ApiJsonBody,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
  ApiRequestListParameters,
} from '../openapi/decorators.js';
import {
  arraySchema,
  pageSchema,
  REQUEST_BODY_SCHEMA,
  REQUEST_TRANSITION_SCHEMA,
  WORKFLOW_REQUEST_SCHEMA,
} from '../openapi/schemas.js';

@ApiTags('requests')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('requests')
export class RequestController {
  public constructor(
    private readonly requests: RequestService,
    private readonly operations: OperationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List workflow requests in the selected tenant' })
  @ApiRequestListParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Filtered, sorted page of tenant workflow requests.',
    schema: pageSchema(WORKFLOW_REQUEST_SCHEMA),
  })
  public async list(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(RequestListQuerySchema)) query: RequestListQuery,
  ): Promise<PageEnvelope<WorkflowRequestView>> {
    const result = await this.requests.list(
      context,
      query.page,
      query.pageSize,
      query.status,
      query.search,
      query.sortBy,
      query.sortDirection,
    );
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Submit a workflow request with durable idempotency' })
  @ApiJsonBody(
    REQUEST_BODY_SCHEMA,
    'Workflow stable key and payload validated by its active schema.',
  )
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Durably accepted workflow request.',
    schema: WORKFLOW_REQUEST_SCHEMA,
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'The payload does not satisfy the active workflow JSON Schema.',
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } },
    },
  })
  public async submit(
    @CurrentTenant() context: TenantContext,
    @Body(new ZodValidationPipe(SubmitWorkflowRequestSchema)) input: SubmitWorkflowRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<WorkflowRequestView> {
    const result = await this.requests.submit(
      context,
      input,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
      'rest',
    );
    response.status(result.statusCode);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    if (result.statusCode === 422) {
      throw new UnprocessableEntityException({
        message: 'Workflow payload validation failed',
        details: { validationErrors: result.body.validationErrors },
      });
    }
    const request = result.body.request;
    if (
      request === undefined ||
      request === null ||
      typeof request !== 'object' ||
      Array.isArray(request)
    ) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored request response is invalid');
    }
    return request as WorkflowRequestView;
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get a tenant-scoped workflow request' })
  @ApiQueueForgeJsonResponse({
    description: 'Tenant-scoped workflow request.',
    schema: WORKFLOW_REQUEST_SCHEMA,
  })
  public get(
    @CurrentTenant() context: TenantContext,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): ReturnType<RequestService['get']> {
    return this.requests.get(context, requestId);
  }

  @Get(':requestId/timeline')
  @ApiOperation({ summary: 'Get the ordered state transition timeline' })
  @ApiQueueForgeJsonResponse({
    description: 'Chronological request state-transition timeline.',
    schema: arraySchema(REQUEST_TRANSITION_SCHEMA),
  })
  public timeline(
    @CurrentTenant() context: TenantContext,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
  ): ReturnType<RequestService['timeline']> {
    return this.requests.timeline(context, requestId);
  }

  @Post(':requestId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending-approval or queued request' })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    description: 'Cancelled workflow request.',
    schema: WORKFLOW_REQUEST_SCHEMA,
  })
  public cancel(
    @CurrentTenant() context: TenantContext,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<OperationsService['cancelRequest']> {
    return this.operations.cancelRequest(
      context,
      requestId,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }

  @Post(':requestId/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry a failed or dead-lettered request with a reset attempt budget' })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    description: 'Requeued workflow request with its attempt budget reset.',
    schema: WORKFLOW_REQUEST_SCHEMA,
  })
  public retry(
    @CurrentTenant() context: TenantContext,
    @Param('requestId', new ParseUUIDPipe()) requestId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<OperationsService['retryRequest']> {
    return this.operations.retryRequest(
      context,
      requestId,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }
}

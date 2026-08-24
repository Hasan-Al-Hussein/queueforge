import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApplicationError, OperationsService } from '@queueforge/application';
import { PageQuerySchema } from '@queueforge/contracts';
import type { JsonObject, PageQuery as PageQueryInput, TenantContext } from '@queueforge/contracts';

import { CurrentTenant, RequestCorrelationId } from '../common/http-context.js';
import { toPage, type PageEnvelope } from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MarkNotificationReadDto } from '../dto.js';
import {
  ApiAuditParameters,
  ApiPageParameters,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import {
  AUDIT_EVENT_SCHEMA,
  DASHBOARD_SCHEMA,
  DEAD_LETTER_SCHEMA,
  NOTIFICATION_SCHEMA,
  pageSchema,
  QUEUE_SCHEMA,
  RETRIED_DEAD_LETTER_SCHEMA,
  arraySchema,
} from '../openapi/schemas.js';

@ApiTags('dashboard')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('dashboard')
export class DashboardController {
  public constructor(private readonly operations: OperationsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get the tenant operations overview' })
  @ApiQueueForgeJsonResponse({
    description: 'Tenant request status, queue backlog, recent requests, and throughput.',
    schema: DASHBOARD_SCHEMA,
  })
  public overview(
    @CurrentTenant() context: TenantContext,
  ): ReturnType<OperationsService['dashboard']> {
    return this.operations.dashboard(context);
  }
}

@ApiTags('operations')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('operations')
export class OperationsController {
  public constructor(private readonly operations: OperationsService) {}

  @Get('queues')
  @ApiOperation({ summary: 'Get queue and outbox health snapshots' })
  @ApiQueueForgeJsonResponse({
    description: 'Queue telemetry and durable outbox backlog by queue.',
    schema: arraySchema(QUEUE_SCHEMA),
  })
  public queues(
    @CurrentTenant() context: TenantContext,
  ): ReturnType<OperationsService['queueOverview']> {
    return this.operations.queueOverview(context);
  }

  @Get('dead-letters')
  @ApiOperation({ summary: 'List open dead letters' })
  @ApiPageParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of open request dead letters.',
    schema: pageSchema(DEAD_LETTER_SCHEMA),
  })
  public async deadLetters(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQueryInput,
  ): Promise<PageEnvelope<JsonObject>> {
    const result = await this.operations.deadLetters(context, page.page, page.pageSize);
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Post('dead-letters/:deadLetterId/retry')
  @ApiOperation({ summary: 'Requeue an open dead letter and reset its attempt budget' })
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Requeued dead-letter resource.',
    schema: RETRIED_DEAD_LETTER_SCHEMA,
  })
  public retryDeadLetter(
    @CurrentTenant() context: TenantContext,
    @Param('deadLetterId', new ParseUUIDPipe()) deadLetterId: string,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<OperationsService['retryDeadLetter']> {
    return this.operations.retryDeadLetter(context, deadLetterId, correlationId);
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('notifications')
export class NotificationController {
  public constructor(private readonly operations: OperationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications addressed to the user or their tenant role' })
  @ApiPageParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of notifications visible to the current user.',
    schema: pageSchema(NOTIFICATION_SCHEMA),
  })
  public async list(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQueryInput,
  ): Promise<PageEnvelope<JsonObject>> {
    const result = await this.operations.notifications(context, page.page, page.pageSize);
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Patch(':notificationId')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiBody({ type: MarkNotificationReadDto })
  @ApiQueueForgeJsonResponse({
    description: 'Notification with the user-specific read timestamp.',
    schema: NOTIFICATION_SCHEMA,
  })
  public async markRead(
    @CurrentTenant() context: TenantContext,
    @Param('notificationId', new ParseUUIDPipe()) notificationId: string,
    @Body() _input: MarkNotificationReadDto,
  ): Promise<JsonObject> {
    void _input;
    const notification = await this.operations.markNotificationRead(context, notificationId);
    if (notification === null) {
      throw new ApplicationError('NOT_FOUND', 'Notification was not found');
    }
    return notification;
  }
}

@ApiTags('audit')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('audit')
export class AuditController {
  public constructor(private readonly operations: OperationsService) {}

  @Get()
  @ApiOperation({ summary: 'List immutable tenant audit events' })
  @ApiAuditParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of immutable, safely redacted tenant audit events.',
    schema: pageSchema(AUDIT_EVENT_SCHEMA),
  })
  public async list(
    @CurrentTenant() context: TenantContext,
    @Query() query: Record<string, string | string[] | undefined>,
  ): Promise<PageEnvelope<JsonObject>> {
    const unknownQueryKey = Object.keys(query).find(
      (key) => !['eventType', 'page', 'pageSize'].includes(key),
    );
    if (unknownQueryKey !== undefined) {
      throw new ApplicationError('VALIDATION_FAILED', 'Unknown audit filter');
    }
    const pageResult = PageQuerySchema.safeParse({
      ...(typeof query.page === 'string' ? { page: query.page } : {}),
      ...(typeof query.pageSize === 'string' ? { pageSize: query.pageSize } : {}),
    });
    if (!pageResult.success) {
      throw new ApplicationError('VALIDATION_FAILED', 'Audit pagination is invalid');
    }
    const rawEventType = query.eventType;
    if (rawEventType !== undefined && typeof rawEventType !== 'string') {
      throw new ApplicationError('VALIDATION_FAILED', 'Audit event type filter is invalid');
    }
    const eventType = rawEventType?.trim();
    if (
      eventType !== undefined &&
      eventType !== '' &&
      !/^[a-z][a-z0-9_.-]{0,159}$/u.test(eventType)
    ) {
      throw new ApplicationError('VALIDATION_FAILED', 'Audit event type filter is invalid');
    }
    const page: PageQueryInput = pageResult.data;
    const result = await this.operations.audit(
      context,
      page.page,
      page.pageSize,
      eventType === '' ? undefined : eventType,
    );
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }
}

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
  RawBody,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { InboundWebhookService, OperationsService, WebhookService } from '@queueforge/application';
import { INBOUND_WEBHOOK_HEADERS, PageQuerySchema } from '@queueforge/contracts';
import type {
  JsonObject,
  PageQuery as PageQueryInput,
  TenantContext,
  WebhookReceipt,
} from '@queueforge/contracts';

import { CurrentTenant, Public, RequestCorrelationId } from '../common/http-context.js';
import {
  requireHeader,
  requireIdempotencyKey,
  toPage,
  type PageEnvelope,
} from '../common/request-values.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CreateWebhookEndpointDto, UpdateWebhookEndpointDto } from '../dto.js';
import {
  ApiIdempotencyKey,
  ApiInboundWebhookContract,
  ApiPageParameters,
  ApiQueueForgeApiKeyAlternative,
  ApiQueueForgeJsonResponse,
} from '../openapi/decorators.js';
import {
  arraySchema,
  CREATED_WEBHOOK_ENDPOINT_SCHEMA,
  INBOUND_WEBHOOK_BODY_SCHEMA,
  pageSchema,
  UUID_SCHEMA,
  WEBHOOK_DELIVERY_SCHEMA,
  WEBHOOK_ENDPOINT_SCHEMA,
  WEBHOOK_RECEIPT_SCHEMA,
} from '../openapi/schemas.js';

@ApiTags('webhooks')
@ApiBearerAuth()
@ApiQueueForgeApiKeyAlternative()
@Controller('webhooks')
export class WebhookController {
  public constructor(
    private readonly operations: OperationsService,
    private readonly webhooks: WebhookService,
  ) {}

  @Get('endpoints')
  @ApiOperation({ summary: 'List outbound webhook endpoints' })
  @ApiQueueForgeJsonResponse({
    description: 'Outbound webhook endpoints without secret material.',
    schema: arraySchema(WEBHOOK_ENDPOINT_SCHEMA),
  })
  public endpoints(
    @CurrentTenant() context: TenantContext,
  ): ReturnType<OperationsService['webhookEndpoints']> {
    return this.operations.webhookEndpoints(context);
  }

  @Post('endpoints')
  @ApiOperation({ summary: 'Create an encrypted outbound webhook signing secret' })
  @ApiBody({ type: CreateWebhookEndpointDto })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Created endpoint and one-time signing secret.',
    schema: CREATED_WEBHOOK_ENDPOINT_SCHEMA,
  })
  public async createEndpoint(
    @CurrentTenant() context: TenantContext,
    @Body() input: CreateWebhookEndpointDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WebhookService['createEndpoint']> {
    return this.webhooks.createEndpoint(
      context,
      input,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }

  @Patch('endpoints/:endpointId')
  @ApiOperation({ summary: 'Rename, retarget, enable, or disable an outbound endpoint' })
  @ApiBody({ type: UpdateWebhookEndpointDto })
  @ApiQueueForgeJsonResponse({
    description: 'Updated outbound webhook endpoint.',
    schema: WEBHOOK_ENDPOINT_SCHEMA,
  })
  public updateEndpoint(
    @CurrentTenant() context: TenantContext,
    @Param('endpointId', new ParseUUIDPipe()) endpointId: string,
    @Body() input: UpdateWebhookEndpointDto,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WebhookService['updateEndpoint']> {
    return this.webhooks.updateEndpoint(context, endpointId, input, correlationId);
  }

  @Get('deliveries')
  @ApiOperation({ summary: 'List outbound delivery history' })
  @ApiPageParameters()
  @ApiQueueForgeJsonResponse({
    description: 'Page of outbound webhook delivery attempts and state.',
    schema: pageSchema(WEBHOOK_DELIVERY_SCHEMA),
  })
  public async deliveries(
    @CurrentTenant() context: TenantContext,
    @Query(new ZodValidationPipe(PageQuerySchema)) page: PageQueryInput,
  ): Promise<PageEnvelope<JsonObject>> {
    const result = await this.operations.webhookDeliveries(context, page.page, page.pageSize);
    return toPage(result.items, result.page, result.pageSize, result.totalItems);
  }

  @Post('deliveries/:deliveryId/replay')
  @ApiOperation({ summary: 'Create an audited delivery replay generation' })
  @ApiIdempotencyKey()
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.CREATED,
    description: 'Identifier of the newly created replay delivery generation.',
    schema: UUID_SCHEMA,
  })
  public replay(
    @CurrentTenant() context: TenantContext,
    @Param('deliveryId', new ParseUUIDPipe()) deliveryId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): ReturnType<WebhookService['replayDelivery']> {
    return this.webhooks.replayDelivery(
      context,
      deliveryId,
      requireIdempotencyKey(idempotencyKey),
      correlationId,
    );
  }
}

@ApiTags('inbound webhooks')
@Controller('inbound/webhooks')
export class InboundWebhookController {
  public constructor(private readonly inbound: InboundWebhookService) {}

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Post(':tenantSlug/:endpointId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Authenticate and durably accept a signed inbound workflow request' })
  @ApiInboundWebhookContract(INBOUND_WEBHOOK_BODY_SCHEMA)
  @ApiQueueForgeJsonResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Durable inbound webhook receipt. Duplicate events return the original receipt.',
    schema: WEBHOOK_RECEIPT_SCHEMA,
  })
  public accept(
    @Param('tenantSlug') tenantSlug: string,
    @Param('endpointId', new ParseUUIDPipe()) endpointId: string,
    @RawBody() rawBody: Buffer | undefined,
    @Headers(INBOUND_WEBHOOK_HEADERS.eventId) eventId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers(INBOUND_WEBHOOK_HEADERS.keyId) keyId: string | undefined,
    @Headers(INBOUND_WEBHOOK_HEADERS.nonce) nonce: string | undefined,
    @Headers(INBOUND_WEBHOOK_HEADERS.signature) signature: string | undefined,
    @Headers(INBOUND_WEBHOOK_HEADERS.timestamp) timestamp: string | undefined,
    @RequestCorrelationId() correlationId: string,
  ): Promise<WebhookReceipt> {
    return this.inbound.accept(
      tenantSlug,
      endpointId,
      rawBody ?? Buffer.alloc(0),
      {
        eventId: requireHeader(eventId, INBOUND_WEBHOOK_HEADERS.eventId),
        idempotencyKey: requireIdempotencyKey(idempotencyKey),
        keyId: requireHeader(keyId, INBOUND_WEBHOOK_HEADERS.keyId),
        nonce: requireHeader(nonce, INBOUND_WEBHOOK_HEADERS.nonce),
        signature: requireHeader(signature, INBOUND_WEBHOOK_HEADERS.signature),
        timestamp: requireHeader(timestamp, INBOUND_WEBHOOK_HEADERS.timestamp),
      },
      correlationId,
    );
  }
}

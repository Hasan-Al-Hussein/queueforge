import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

import { EventEnvelopeSchema } from '@queueforge/contracts';
import {
  PersistenceConflictError,
  PersistenceNotFoundError,
  ProcessedEventStore,
  WebhookDeliveryStore,
} from '@queueforge/persistence';

import { boundedExponentialBackoff } from '../core/backoff.js';
import { RetryableDeliveryError } from '../core/errors.js';
import { parseEventEnvelope } from '../core/jobs.js';
import {
  WEBHOOK_SECRET_PROVIDER,
  WORKER_CONFIGURATION,
  WORKER_ID,
  type WebhookSecretProviderPort,
  type WorkerConfiguration,
} from '../core/ports.js';
import { deliverWebhookHttp } from '../security/webhook-http-client.js';
import type { WebhookHttpDeliveryResult } from '../security/webhook-http-client.js';

const WEBHOOK_CONSUMER = 'queueforge.webhook-delivery.v1';
const WebhookJobPayloadSchema = z.object({ deliveryId: z.string().uuid() }).passthrough();

@Injectable()
export class WebhookJobHandlerService {
  private readonly logger = new Logger(WebhookJobHandlerService.name);

  public constructor(
    private readonly processedEvents: ProcessedEventStore,
    private readonly deliveries: WebhookDeliveryStore,
    @Inject(WEBHOOK_SECRET_PROVIDER) private readonly secrets: WebhookSecretProviderPort,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
    @Inject(WORKER_ID) private readonly workerId: string,
  ) {}

  public async handle(job: Job): Promise<void> {
    const event = parseEventEnvelope(job.data);
    if (await this.processedEvents.has(event.tenantId, WEBHOOK_CONSUMER, event.eventId)) {
      return;
    }
    const scope = { tenantId: event.tenantId };
    const { deliveryId } = WebhookJobPayloadSchema.parse(event.payload);
    const delivery = await this.deliveries.claimOrRecover(
      scope,
      deliveryId,
      this.workerId,
      this.configuration.leaseSeconds,
      { consumer: WEBHOOK_CONSUMER, eventId: event.eventId },
    );
    if (delivery === null) {
      throw new RetryableDeliveryError(
        'Webhook delivery is not ready to claim',
        'WEBHOOK_NOT_READY',
      );
    }
    if (!('id' in delivery)) {
      return;
    }

    let result: WebhookHttpDeliveryResult;
    const outboundEvent = EventEnvelopeSchema.safeParse(delivery.payload);
    if (
      !outboundEvent.success ||
      outboundEvent.data.eventId !== delivery.eventId ||
      outboundEvent.data.tenantId !== event.tenantId
    ) {
      result = {
        durationMs: 0,
        errorCode: 'WEBHOOK_PAYLOAD_INVALID',
        errorMessage: 'Stored webhook payload does not match its immutable delivery binding',
        outcome: 'terminal_failure',
        responseBodyExcerpt: null,
        statusCode: null,
      };
    } else {
      try {
        const secret = await this.secrets.getSigningSecret(
          scope,
          delivery.endpointId,
          delivery.keyId,
        );
        const rawBody = Buffer.from(canonicalize(outboundEvent.data), 'utf8');
        result = await deliverWebhookHttp({
          attempt: delivery.attemptCount,
          correlationId: outboundEvent.data.correlationId,
          eventId: delivery.eventId,
          keyId: delivery.keyId,
          policy: {
            allowPrivateNetworks: this.configuration.allowPrivateNetworks,
            allowedHosts: this.configuration.allowedWebhookHosts,
          },
          rawBody,
          secret,
          targetUrl: delivery.targetUrl,
          timeoutMs: this.configuration.webhookTimeoutMs,
        });
      } catch (error) {
        const terminalSecretFailure =
          error instanceof PersistenceNotFoundError ||
          (error instanceof PersistenceConflictError && error.code === 'WEBHOOK_SECRET_INVALID');
        result = terminalSecretFailure
          ? {
              durationMs: 0,
              errorCode: 'WEBHOOK_SECRET_UNAVAILABLE',
              errorMessage: 'Webhook signing secret is unavailable',
              outcome: 'terminal_failure',
              responseBodyExcerpt: null,
              statusCode: null,
            }
          : {
              durationMs: 0,
              errorCode: 'WEBHOOK_SECRET_PROVIDER_UNAVAILABLE',
              errorMessage: 'Webhook signing secret provider is temporarily unavailable',
              outcome: 'retryable_failure',
              responseBodyExcerpt: null,
              statusCode: null,
            };
      }
    }
    const retryAt = new Date(
      Date.now() + boundedExponentialBackoff(delivery.attemptCount, undefined, () => 0),
    );
    const status = await this.deliveries.recordAttemptOnce(
      scope,
      event.eventId,
      WEBHOOK_CONSUMER,
      delivery.id,
      delivery.attemptCount,
      {
        durationMs: result.durationMs,
        errorCode: result.errorCode ?? undefined,
        errorMessage: result.errorMessage ?? undefined,
        responseBodyExcerpt: result.responseBodyExcerpt ?? undefined,
        responseStatus: result.statusCode ?? undefined,
        retryAt,
        terminal: result.outcome === 'terminal_failure',
      },
    );
    if (status === 'retry') {
      throw new RetryableDeliveryError(
        'Webhook delivery will be retried',
        'WEBHOOK_RETRY_SCHEDULED',
      );
    }
    if (status === 'dead') {
      this.logger.error(
        { deliveryId, eventId: delivery.eventId, tenantId: event.tenantId },
        'Webhook delivery moved to the dead-letter queue',
      );
    }
  }
}

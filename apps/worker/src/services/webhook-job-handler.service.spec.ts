import { randomUUID } from 'node:crypto';

import type { Job } from 'bullmq';

import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type EventEnvelope } from '@queueforge/contracts';
import {
  PersistenceNotFoundError,
  type ProcessedEventStore,
  type WebhookDeliveryRecord,
  type WebhookDeliveryStore,
} from '@queueforge/persistence';

import { RetryableDeliveryError } from '../core/errors.js';

import type { WebhookSecretProviderPort, WorkerConfiguration } from '../core/ports.js';
import { WebhookJobHandlerService } from './webhook-job-handler.service.js';

const configuration: WorkerConfiguration = {
  allowPrivateNetworks: true,
  allowedWebhookHosts: new Set(['127.0.0.1']),
  concurrency: 1,
  databaseUrl: 'postgresql://queueforge.invalid/queueforge',
  heartbeatIntervalMs: 10_000,
  leaseSeconds: 30,
  outboxPollIntervalMs: 1_000,
  redisUrl: 'redis://127.0.0.1:6379',
  requestTimeoutMs: 5_000,
  webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
  webhookTimeoutMs: 1_000,
};

function eventFixture(deliveryId: string): EventEnvelope {
  return {
    aggregateId: deliveryId,
    aggregateType: 'webhook_delivery',
    correlationId: randomUUID(),
    eventId: randomUUID(),
    eventType: EVENT_TYPES.webhookDeliveryRequested,
    occurredAt: new Date().toISOString(),
    payload: { deliveryId },
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: randomUUID(),
  };
}

function claimedDelivery(event: EventEnvelope, deliveryId: string): WebhookDeliveryRecord {
  const outboundEventId = randomUUID();
  return {
    attemptCount: 1,
    endpointId: randomUUID(),
    eventId: outboundEventId,
    generation: 1,
    id: deliveryId,
    keyId: 'local-v1',
    maxAttempts: 5,
    payload: {
      aggregateId: randomUUID(),
      aggregateType: 'workflow_request',
      correlationId: event.correlationId,
      eventId: outboundEventId,
      eventType: EVENT_TYPES.requestSucceeded,
      occurredAt: new Date().toISOString(),
      payload: { requestId: randomUUID() },
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: event.tenantId,
    },
    targetUrl: 'http://127.0.0.1:3300/webhooks',
  };
}

describe('WebhookJobHandlerService replay and terminal handling', () => {
  it('short-circuits an already processed outbox replay before claiming a delivery', async () => {
    const event = eventFixture(randomUUID());
    const claimOrRecover = jest.fn();
    const handler = new WebhookJobHandlerService(
      { has: jest.fn().mockResolvedValue(true) } as unknown as ProcessedEventStore,
      { claimOrRecover } as unknown as WebhookDeliveryStore,
      { getSigningSecret: jest.fn() } as unknown as WebhookSecretProviderPort,
      configuration,
      'worker-test',
    );

    await handler.handle({ data: event } as unknown as Job);

    expect(claimOrRecover).not.toHaveBeenCalled();
  });

  it('records an invalid immutable payload as a terminal attempt with a processed receipt', async () => {
    const deliveryId = randomUUID();
    const stableEventId = randomUUID();
    const event = eventFixture(deliveryId);
    const recordAttemptOnce = jest.fn().mockResolvedValue('dead');
    const deliveries = {
      claimOrRecover: jest.fn().mockResolvedValue({
        attemptCount: 1,
        endpointId: randomUUID(),
        eventId: stableEventId,
        generation: 1,
        id: deliveryId,
        keyId: 'local-v1',
        maxAttempts: 5,
        payload: { invalid: true },
        targetUrl: 'http://127.0.0.1:3300/webhooks',
      }),
      recordAttemptOnce,
    } as unknown as WebhookDeliveryStore;
    const handler = new WebhookJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      deliveries,
      { getSigningSecret: jest.fn() } as unknown as WebhookSecretProviderPort,
      configuration,
      'worker-test',
    );

    await handler.handle({ data: event } as unknown as Job);

    expect(recordAttemptOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.webhook-delivery.v1',
      deliveryId,
      1,
      expect.objectContaining({
        errorCode: 'WEBHOOK_PAYLOAD_INVALID',
        terminal: true,
      }),
    );
  });

  it('binds terminal receipt recovery and returns when an expired lease is dead-lettered', async () => {
    const deliveryId = randomUUID();
    const event = eventFixture(deliveryId);
    const claimOrRecover = jest.fn().mockResolvedValue({ deadLettered: true });
    const handler = new WebhookJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      { claimOrRecover } as unknown as WebhookDeliveryStore,
      { getSigningSecret: jest.fn() } as unknown as WebhookSecretProviderPort,
      configuration,
      'worker-test',
    );

    await expect(handler.handle({ data: event } as unknown as Job)).resolves.toBeUndefined();
    expect(claimOrRecover).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      deliveryId,
      'worker-test',
      configuration.leaseSeconds,
      {
        consumer: 'queueforge.webhook-delivery.v1',
        eventId: event.eventId,
      },
    );
  });

  it('records an unexpected secret-provider outage as retryable for BullMQ', async () => {
    const deliveryId = randomUUID();
    const event = eventFixture(deliveryId);
    const recordAttemptOnce = jest.fn().mockResolvedValue('retry');
    const handler = new WebhookJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        claimOrRecover: jest.fn().mockResolvedValue(claimedDelivery(event, deliveryId)),
        recordAttemptOnce,
      } as unknown as WebhookDeliveryStore,
      {
        getSigningSecret: jest.fn().mockRejectedValue(new Error('database unavailable')),
      },
      configuration,
      'worker-test',
    );

    await expect(handler.handle({ data: event } as unknown as Job)).rejects.toBeInstanceOf(
      RetryableDeliveryError,
    );
    expect(recordAttemptOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.webhook-delivery.v1',
      deliveryId,
      1,
      expect.objectContaining({
        errorCode: 'WEBHOOK_SECRET_PROVIDER_UNAVAILABLE',
        terminal: false,
      }),
    );
  });

  it('records a typed missing signing secret as terminal', async () => {
    const deliveryId = randomUUID();
    const event = eventFixture(deliveryId);
    const recordAttemptOnce = jest.fn().mockResolvedValue('dead');
    const handler = new WebhookJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        claimOrRecover: jest.fn().mockResolvedValue(claimedDelivery(event, deliveryId)),
        recordAttemptOnce,
      } as unknown as WebhookDeliveryStore,
      {
        getSigningSecret: jest
          .fn()
          .mockRejectedValue(new PersistenceNotFoundError('active webhook signing secret')),
      },
      configuration,
      'worker-test',
    );

    await expect(handler.handle({ data: event } as unknown as Job)).resolves.toBeUndefined();
    expect(recordAttemptOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.webhook-delivery.v1',
      deliveryId,
      1,
      expect.objectContaining({ errorCode: 'WEBHOOK_SECRET_UNAVAILABLE', terminal: true }),
    );
  });
});

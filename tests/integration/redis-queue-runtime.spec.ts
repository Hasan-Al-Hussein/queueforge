import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  QUEUE_NAMES,
  type EventEnvelope,
} from '../../packages/contracts/src/index.js';
import type { WorkerConfiguration } from '../../apps/worker/src/core/ports.js';
import type { NotificationJobHandlerService } from '../../apps/worker/src/services/notification-job-handler.service.js';
import { QueueRuntimeService } from '../../apps/worker/src/services/queue-runtime.service.js';
import type { RequestJobHandlerService } from '../../apps/worker/src/services/request-job-handler.service.js';
import type { WebhookJobHandlerService } from '../../apps/worker/src/services/webhook-job-handler.service.js';

function isolatedRedisUrl(value: string): string {
  const url = new URL(value);
  url.pathname = '/13';
  return url.toString();
}

describe('BullMQ Redis runtime integration', () => {
  it('deduplicates a deterministic event job and drains all worker connections', async () => {
    const redisUrl = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'];
    if (redisUrl === undefined) {
      throw new Error('TEST_REDIS_URL or REDIS_URL is required for Redis integration tests');
    }
    const requestId = randomUUID();
    const event: EventEnvelope = {
      aggregateId: requestId,
      aggregateType: 'workflow_request',
      correlationId: randomUUID(),
      eventId: randomUUID(),
      eventType: EVENT_TYPES.requestQueued,
      occurredAt: new Date().toISOString(),
      payload: { requestId },
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId: randomUUID(),
    };
    let resolveHandled: ((handled: EventEnvelope) => void) | undefined;
    const handled = new Promise<EventEnvelope>((resolve) => {
      resolveHandled = resolve;
    });
    const requestHandler = {
      handle: jest.fn().mockImplementation((job: { readonly data: EventEnvelope }) => {
        resolveHandled?.(job.data);
        return Promise.resolve();
      }),
    } as unknown as RequestJobHandlerService;
    const runtime = new QueueRuntimeService(
      requestHandler,
      { handle: jest.fn().mockResolvedValue(undefined) } as unknown as WebhookJobHandlerService,
      {
        handle: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationJobHandlerService,
      {
        allowPrivateNetworks: true,
        allowedWebhookHosts: new Set(['127.0.0.1']),
        concurrency: 1,
        databaseUrl: process.env['DATABASE_URL'] ?? '',
        heartbeatIntervalMs: 10_000,
        leaseSeconds: 30,
        outboxPollIntervalMs: 1_000,
        redisUrl: isolatedRedisUrl(redisUrl),
        requestTimeoutMs: 5_000,
        webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
        webhookTimeoutMs: 1_000,
      } satisfies WorkerConfiguration,
      `qa-redis-worker-${randomUUID()}`,
    );
    const options = {
      attempts: 1,
      backoffType: 'queueforge-bounded',
      jobId: `qf-${event.eventId}`,
    };

    try {
      await runtime.start();
      await runtime.publish(QUEUE_NAMES.requests, event, options);
      await runtime.publish(QUEUE_NAMES.requests, event, options);
      const timeout = new Promise<never>((_resolve, reject) => {
        const handle = setTimeout(() => reject(new Error('Redis job was not processed')), 5_000);
        handle.unref();
      });
      await expect(Promise.race([handled, timeout])).resolves.toEqual(event);
      await delay(100);
      expect(requestHandler.handle).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.drain();
    }

    expect(runtime.snapshot()).toEqual({ activeJobs: 0, queues: [], state: 'stopped' });
  });
});

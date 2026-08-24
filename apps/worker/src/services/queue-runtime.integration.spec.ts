import { randomUUID } from 'node:crypto';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  QUEUE_NAMES,
  type EventEnvelope,
} from '@queueforge/contracts';

import type { WorkerConfiguration } from '../core/ports.js';
import type { NotificationJobHandlerService } from './notification-job-handler.service.js';
import { QueueRuntimeService } from './queue-runtime.service.js';
import type { RequestJobHandlerService } from './request-job-handler.service.js';
import type { WebhookJobHandlerService } from './webhook-job-handler.service.js';

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl === undefined ? describe.skip : describe;

function isolatedRedisUrl(value: string): string {
  const url = new URL(value);
  url.pathname = '/14';
  return url.toString();
}

describeWithRedis('QueueRuntimeService with Redis', () => {
  it('processes a deterministic job and drains every queue connection', async () => {
    if (redisUrl === undefined) {
      throw new Error('TEST_REDIS_URL is required for this integration test');
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
        databaseUrl: 'postgresql://queueforge.invalid/queueforge',
        heartbeatIntervalMs: 10_000,
        leaseSeconds: 30,
        outboxPollIntervalMs: 1_000,
        redisUrl: isolatedRedisUrl(redisUrl),
        requestTimeoutMs: 5_000,
        webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
        webhookTimeoutMs: 1_000,
      } satisfies WorkerConfiguration,
      `worker-integration-${randomUUID()}`,
    );

    try {
      await runtime.start();
      await runtime.publish(QUEUE_NAMES.requests, event, {
        attempts: 1,
        backoffType: 'queueforge-bounded',
        jobId: `qf-${event.eventId}`,
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        const handle = setTimeout(() => reject(new Error('Redis job was not processed')), 5_000);
        handle.unref();
      });
      await expect(Promise.race([handled, timeout])).resolves.toEqual(event);
      expect(requestHandler.handle).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.drain();
    }

    expect(runtime.snapshot()).toEqual({ activeJobs: 0, queues: [], state: 'stopped' });
  });

  it('durably defers infrastructure failures without exhausting BullMQ attempts', async () => {
    if (redisUrl === undefined) {
      throw new Error('TEST_REDIS_URL is required for this integration test');
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
    let resolveHandled: (() => void) | undefined;
    const handled = new Promise<void>((resolve) => {
      resolveHandled = resolve;
    });
    const attemptsMade: number[] = [];
    const attemptsStarted: number[] = [];
    const requestHandler = {
      handle: jest
        .fn()
        .mockImplementation((job: { attemptsMade: number; attemptsStarted: number }) => {
          attemptsMade.push(job.attemptsMade);
          attemptsStarted.push(job.attemptsStarted);
          if (attemptsStarted.length < 3) {
            return Promise.reject(new Error('temporary database outage'));
          }
          resolveHandled?.();
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
        databaseUrl: 'postgresql://queueforge.invalid/queueforge',
        heartbeatIntervalMs: 10_000,
        leaseSeconds: 30,
        outboxPollIntervalMs: 1_000,
        redisUrl: isolatedRedisUrl(redisUrl),
        requestTimeoutMs: 5_000,
        webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
        webhookTimeoutMs: 1_000,
      } satisfies WorkerConfiguration,
      `worker-integration-${randomUUID()}`,
    );

    try {
      await runtime.start();
      await runtime.publish(QUEUE_NAMES.requests, event, {
        attempts: 1,
        backoffType: 'queueforge-bounded',
        jobId: `qf-${event.eventId}`,
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        const handle = setTimeout(
          () => reject(new Error('Deferred Redis job was not retried')),
          10_000,
        );
        handle.unref();
      });
      await expect(Promise.race([handled, timeout])).resolves.toBeUndefined();
      expect(requestHandler.handle).toHaveBeenCalledTimes(3);
      expect(attemptsMade).toEqual([0, 0, 0]);
      expect(attemptsStarted).toEqual([1, 2, 3]);
    } finally {
      await runtime.drain();
    }
  });
});

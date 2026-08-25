import { randomUUID } from 'node:crypto';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  QUEUE_NAMES,
  type EventEnvelope,
} from '@queueforge/contracts';

import type {
  ClaimedOutboxEvent,
  OutboxStorePort,
  QueuePublisherPort,
  WorkerConfiguration,
} from '../core/ports.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

function claimedEvent(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  const id = randomUUID();
  return {
    aggregateId: randomUUID(),
    aggregateType: 'workflow_request',
    attemptCount: 1,
    correlationId: randomUUID(),
    eventType: EVENT_TYPES.requestQueued,
    id,
    leaseOwner: 'worker-test',
    leaseUntil: new Date(Date.now() + 30_000),
    maxAttempts: 10,
    occurredAt: new Date('2026-08-24T00:00:00.000Z'),
    payload: { requestId: randomUUID() },
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: randomUUID(),
    ...overrides,
  };
}

class FakeOutboxStore implements OutboxStorePort {
  public claimed: readonly ClaimedOutboxEvent[] = [];
  public readonly failed: Array<{ eventId: string; retryAt: Date }> = [];
  public readonly published: string[] = [];
  public recovered = 0;
  public readonly recoveryResults: number[] = [];
  public recoveryCalls = 0;
  public released = 0;
  public readonly order: string[] = [];

  public async claimBatch(): Promise<readonly ClaimedOutboxEvent[]> {
    return this.claimed;
  }

  public async markFailed(
    _tenantId: string,
    eventId: string,
    _leaseOwner: string,
    _errorMessage: string,
    retryAt: Date,
  ): Promise<'retry'> {
    this.failed.push({ eventId, retryAt });
    return 'retry';
  }

  public async markPublished(_tenantId: string, eventId: string): Promise<boolean> {
    this.published.push(eventId);
    this.order.push('published');
    return true;
  }

  public async recoverExpiredLeases(): Promise<number> {
    this.order.push('recovered');
    this.recoveryCalls += 1;
    return this.recoveryResults.shift() ?? this.recovered;
  }

  public async releaseOwnerLeases(): Promise<number> {
    this.order.push('released');
    return this.released;
  }
}

const configuration: WorkerConfiguration = {
  allowPrivateNetworks: true,
  allowedWebhookHosts: new Set(['127.0.0.1']),
  concurrency: 1,
  databaseUrl: 'postgresql://queueforge.invalid/queueforge',
  heartbeatIntervalMs: 10_000,
  leaseSeconds: 30,
  outboxPollIntervalMs: 60_000,
  redisUrl: 'redis://127.0.0.1:6379',
  requestTimeoutMs: 30_000,
  webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
  webhookTimeoutMs: 5_000,
};

describe('OutboxDispatcherService', () => {
  it('publishes a deterministic BullMQ job then acknowledges the lease owner', async () => {
    const store = new FakeOutboxStore();
    const record = claimedEvent();
    store.claimed = [record];
    const published: Array<{
      attempts: number;
      event: EventEnvelope;
      jobId: string;
      queue: string;
    }> = [];
    const publisher: QueuePublisherPort = {
      publish: async (queue, event, options) => {
        published.push({ attempts: options.attempts, event, jobId: options.jobId, queue });
      },
    };
    const dispatcher = new OutboxDispatcherService(store, publisher, configuration, 'worker-test');

    await dispatcher.dispatchOnce();

    expect(published).toEqual([
      expect.objectContaining({
        attempts: 25,
        event: expect.objectContaining({ eventId: record.id }),
        jobId: `qf-${record.id}`,
        queue: QUEUE_NAMES.requests,
      }),
    ]);
    expect(store.published).toEqual([record.id]);
  });

  it('keeps the BullMQ request transport ceiling high enough for attempt 11', async () => {
    const store = new FakeOutboxStore();
    store.claimed = [claimedEvent()];
    const publish = jest.fn<
      ReturnType<QueuePublisherPort['publish']>,
      Parameters<QueuePublisherPort['publish']>
    >(async () => undefined);
    const dispatcher = new OutboxDispatcherService(
      store,
      { publish },
      configuration,
      'worker-test',
    );

    await dispatcher.dispatchOnce();

    expect(publish).toHaveBeenCalledWith(
      QUEUE_NAMES.requests,
      expect.any(Object),
      expect.objectContaining({ attempts: 25 }),
    );
    expect(publish.mock.calls[0]?.[2].attempts).toBeGreaterThanOrEqual(11);
  });

  it('schedules a bounded retry when enqueue fails and does not acknowledge', async () => {
    const store = new FakeOutboxStore();
    const record = claimedEvent();
    store.claimed = [record];
    const dispatcher = new OutboxDispatcherService(
      store,
      { publish: async () => Promise.reject(new Error('redis unavailable')) },
      configuration,
      'worker-test',
    );
    const startedAt = Date.parse('2026-08-25T00:00:00.000Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(startedAt);
    try {
      await dispatcher.dispatchOnce();
    } finally {
      clock.mockRestore();
    }

    expect(store.published).toHaveLength(0);
    expect(store.failed).toHaveLength(1);
    const retryAt = store.failed[0]?.retryAt.getTime() ?? 0;
    expect(retryAt - startedAt).toBeGreaterThanOrEqual(800);
    expect(retryAt - startedAt).toBeLessThanOrEqual(1_200);
  });

  it('routes materialized delivery events and does not treat request success as an effect job', async () => {
    const store = new FakeOutboxStore();
    const observed = claimedEvent({ eventType: EVENT_TYPES.requestSucceeded });
    const webhook = claimedEvent({
      aggregateType: 'webhook_delivery',
      eventType: EVENT_TYPES.webhookDeliveryRequested,
      payload: { deliveryId: randomUUID() },
    });
    const notification = claimedEvent({
      aggregateType: 'notification',
      eventType: EVENT_TYPES.notificationRequested,
      payload: { notificationId: randomUUID() },
    });
    store.claimed = [observed, webhook, notification];
    const publications: Array<{ attempts: number; queue: string }> = [];
    const dispatcher = new OutboxDispatcherService(
      store,
      {
        publish: async (queue, _event, options) => {
          publications.push({ attempts: options.attempts, queue });
        },
      },
      configuration,
      'worker-test',
    );

    await dispatcher.dispatchOnce();

    expect(publications.sort((left, right) => left.queue.localeCompare(right.queue))).toEqual(
      [
        { attempts: 10, queue: QUEUE_NAMES.notifications },
        { attempts: 10, queue: QUEUE_NAMES.webhooks },
      ].sort((left, right) => left.queue.localeCompare(right.queue)),
    );
    expect(store.published).toEqual(
      expect.arrayContaining([observed.id, webhook.id, notification.id]),
    );
  });

  it('recovers expired leases on startup and releases owned leases only after inflight publish settles', async () => {
    const store = new FakeOutboxStore();
    store.recovered = 2;
    store.released = 1;
    await new OutboxDispatcherService(
      store,
      { publish: async () => undefined },
      configuration,
      'worker-test',
    ).start();
    expect(store.order[0]).toBe('recovered');

    const record = claimedEvent();
    store.claimed = [record];
    let resolvePublish: (() => void) | undefined;
    const publishGate = new Promise<void>((resolve) => {
      resolvePublish = resolve;
    });
    const dispatcher = new OutboxDispatcherService(
      store,
      { publish: async () => publishGate },
      configuration,
      'worker-test',
    );
    const dispatch = dispatcher.dispatchOnce();
    const stopping = dispatcher.stop();
    await Promise.resolve();
    expect(store.order).not.toContain('released');

    resolvePublish?.();
    await Promise.all([dispatch, stopping]);
    expect(store.order.slice(-2)).toEqual(['published', 'released']);
  });

  it('drains more than one recovery batch and rechecks leases on every poll', async () => {
    const store = new FakeOutboxStore();
    store.recoveryResults.push(100, 100, 37, 0);
    const dispatcher = new OutboxDispatcherService(
      store,
      { publish: async () => undefined },
      configuration,
      'worker-test',
    );

    await dispatcher.dispatchOnce();
    expect(store.recoveryCalls).toBe(3);
    await dispatcher.dispatchOnce();
    expect(store.recoveryCalls).toBe(4);
  });

  it('still releases owned leases when an inflight dispatch cannot persist its retry', async () => {
    const record = claimedEvent();
    const store = new FakeOutboxStore();
    store.claimed = [record];
    store.markFailed = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const dispatcher = new OutboxDispatcherService(
      store,
      { publish: jest.fn().mockRejectedValue(new Error('redis unavailable')) },
      configuration,
      'worker-test',
    );

    const dispatch = dispatcher.dispatchOnce();
    await expect(dispatcher.stop()).rejects.toThrow('database unavailable');
    await expect(dispatch).rejects.toThrow('database unavailable');
    expect(store.order).toContain('released');
  });
});

import { describe, expect, it } from 'vitest';

import { QueueSnapshotSchema, WebhookDeliverySchema } from './models';

const delivery = {
  attemptCount: 2,
  endpointName: 'Local audit sink',
  eventId: 'e11ca179-22b7-431a-8b6a-82f5a40f730f',
  eventType: 'request.approved',
  id: 'e65444ea-d871-4f7c-854f-48a114a0d5e1',
  lastStatusCode: 503,
  nextAttemptAt: '2026-08-24T12:47:30.000Z',
  requestId: 'd65444ea-d871-4f7c-854f-48a114a0d5e2',
  status: 'retry',
  updatedAt: '2026-08-24T12:42:30.000Z',
  workflowName: 'Expense review',
} as const;

describe('WebhookDeliverySchema', () => {
  it.each(['pending', 'delivering', 'retry', 'delivered', 'dead'] as const)(
    'accepts the persisted %s lifecycle state',
    (status) => {
      expect(WebhookDeliverySchema.safeParse({ ...delivery, status }).success).toBe(true);
    },
  );

  it.each(['processing', 'published', 'failed'] as const)(
    'rejects the non-persisted %s state',
    (status) => {
      expect(WebhookDeliverySchema.safeParse({ ...delivery, status }).success).toBe(false);
    },
  );
});

describe('QueueSnapshotSchema', () => {
  it('keeps worker freshness and persisted outbox pressure distinct from BullMQ counts', () => {
    expect(
      QueueSnapshotSchema.parse({
        active: 1,
        delayed: 2,
        failed: 3,
        heartbeatAt: '2026-08-24T15:00:00.000Z',
        name: 'requests',
        outboxBacklog: 5,
        outboxDead: 1,
        paused: false,
        telemetryAvailable: true,
        waiting: 4,
        workerCount: 2,
        workerState: 'running',
      }),
    ).toMatchObject({ outboxBacklog: 5, waiting: 4, workerCount: 2 });
  });
});

import { randomUUID } from 'node:crypto';

import type { Job } from 'bullmq';

import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type EventEnvelope } from '@queueforge/contracts';
import type { NotificationStore, ProcessedEventStore } from '@queueforge/persistence';

import type { NotificationProviderPort } from '../core/ports.js';
import { NotificationJobHandlerService } from './notification-job-handler.service.js';

function eventFixture(notificationId: string): EventEnvelope {
  return {
    aggregateId: notificationId,
    aggregateType: 'notification',
    correlationId: randomUUID(),
    eventId: randomUUID(),
    eventType: EVENT_TYPES.notificationRequested,
    occurredAt: new Date().toISOString(),
    payload: { notificationId },
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: randomUUID(),
  };
}

describe('NotificationJobHandlerService terminal receipts', () => {
  it('atomically records a terminal provider failure before returning success to BullMQ', async () => {
    const notificationId = randomUUID();
    const event = eventFixture(notificationId);
    const recordDeliveryOnce = jest.fn().mockResolvedValue('processed');
    const notifications = {
      get: jest.fn().mockResolvedValue({
        body: 'Synthetic body',
        id: notificationId,
        recipientKind: 'role',
        recipientRef: 'operator',
        status: 'pending',
        title: 'Synthetic title',
      }),
      recordDeliveryOnce,
    } as unknown as NotificationStore;
    const provider: NotificationProviderPort = {
      deliver: jest.fn().mockRejectedValue(new Error('console unavailable')),
      name: 'console',
    };
    const handler = new NotificationJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      notifications,
      provider,
    );

    await handler.handle({ data: event } as unknown as Job);

    expect(recordDeliveryOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.notification-console.v1',
      notificationId,
      'console',
      expect.objectContaining({ delivered: false }),
    );
  });

  it('lets a success-receipt persistence failure escape without recording a false provider failure', async () => {
    const notificationId = randomUUID();
    const event = eventFixture(notificationId);
    const persistenceFailure = new Error('database unavailable');
    const recordDeliveryOnce = jest.fn().mockRejectedValue(persistenceFailure);
    const provider: NotificationProviderPort = {
      deliver: jest.fn().mockResolvedValue(undefined),
      name: 'console',
    };
    const handler = new NotificationJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        get: jest.fn().mockResolvedValue({
          body: 'Synthetic body',
          id: notificationId,
          recipientKind: 'role',
          recipientRef: 'operator',
          status: 'pending',
          title: 'Synthetic title',
        }),
        recordDeliveryOnce,
      } as unknown as NotificationStore,
      provider,
    );

    await expect(handler.handle({ data: event } as unknown as Job)).rejects.toBe(
      persistenceFailure,
    );
    expect(provider.deliver).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnce).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnce).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { delivered: true },
    );
  });

  it('uses the durable receipt to suppress provider replay after an unknown commit outcome', async () => {
    const notificationId = randomUUID();
    const event = eventFixture(notificationId);
    const has = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const provider: NotificationProviderPort = {
      deliver: jest.fn().mockResolvedValue(undefined),
      name: 'console',
    };
    const recordDeliveryOnce = jest.fn().mockRejectedValue(new Error('commit outcome unknown'));
    const handler = new NotificationJobHandlerService(
      { has } as unknown as ProcessedEventStore,
      {
        get: jest.fn().mockResolvedValue({
          body: 'Synthetic body',
          id: notificationId,
          recipientKind: 'role',
          recipientRef: 'operator',
          status: 'pending',
          title: 'Synthetic title',
        }),
        recordDeliveryOnce,
      } as unknown as NotificationStore,
      provider,
    );

    await expect(handler.handle({ data: event } as unknown as Job)).rejects.toThrow(
      'commit outcome unknown',
    );
    await expect(handler.handle({ data: event } as unknown as Job)).resolves.toBeUndefined();
    expect(provider.deliver).toHaveBeenCalledTimes(1);
    expect(recordDeliveryOnce).toHaveBeenCalledTimes(1);
  });
});

import {
  EVENT_TYPES,
  EventEnvelopeSchema,
  QUEUE_NAMES,
  type EventEnvelope,
} from '@queueforge/contracts';

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const EVENT_QUEUE_MAP: Readonly<Record<string, QueueName>> = Object.freeze({
  [EVENT_TYPES.notificationRequested]: QUEUE_NAMES.notifications,
  [EVENT_TYPES.requestQueued]: QUEUE_NAMES.requests,
  [EVENT_TYPES.webhookDeliveryRequested]: QUEUE_NAMES.webhooks,
});

export function deterministicJobId(eventId: string): string {
  return `qf-${eventId}`;
}

export function queueForEvent(eventType: string): QueueName | undefined {
  return EVENT_QUEUE_MAP[eventType];
}

export function parseEventEnvelope(value: unknown): EventEnvelope {
  return EventEnvelopeSchema.parse(value);
}

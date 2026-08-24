export const API_PREFIX = '/api/v1' as const;
export const GRAPHQL_PATH = '/graphql' as const;

export const QUEUE_NAMES = {
  requests: 'queueforge.requests',
  webhooks: 'queueforge.webhooks',
  notifications: 'queueforge.notifications',
} as const;

export const EVENT_TYPES = {
  requestQueued: 'request.queued',
  requestApproved: 'request.approved',
  requestRejected: 'request.rejected',
  requestCancelled: 'request.cancelled',
  requestSucceeded: 'request.succeeded',
  requestFailed: 'request.failed',
  requestDeadLettered: 'request.dead_lettered',
  webhookDeliveryRequested: 'webhook.delivery.requested',
  notificationRequested: 'notification.requested',
} as const;

export const INBOUND_WEBHOOK_HEADERS = {
  eventId: 'x-queueforge-event-id',
  keyId: 'x-queueforge-key-id',
  nonce: 'x-queueforge-nonce',
  signature: 'x-queueforge-signature',
  timestamp: 'x-queueforge-timestamp',
} as const;

export const OUTBOUND_WEBHOOK_HEADERS = {
  attempt: 'x-queueforge-attempt',
  eventId: 'x-queueforge-event-id',
  keyId: 'x-queueforge-key-id',
  signature: 'x-queueforge-signature',
  timestamp: 'x-queueforge-timestamp',
} as const;

export const IDEMPOTENCY_HEADER = 'idempotency-key' as const;
export const CORRELATION_HEADER = 'x-correlation-id' as const;
export const REQUEST_ID_HEADER = 'x-request-id' as const;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const EVENT_SCHEMA_VERSION = 1;

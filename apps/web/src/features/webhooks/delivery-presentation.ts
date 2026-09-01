import type { WebhookDelivery } from '../../domain/models';

export type DeliverySection = 'deliveries' | 'endpoints';

export function initialDeliverySection(canConfigureConnections: boolean): DeliverySection {
  return canConfigureConnections ? 'endpoints' : 'deliveries';
}

const EVENT_LABELS: Readonly<Record<string, string>> = {
  'approval.approved': 'Approval granted',
  'approval.rejected': 'Approval declined',
  'request.approved': 'Request approved',
  'request.cancelled': 'Request cancelled',
  'request.dead_lettered': 'Request needs help',
  'request.failed': 'Request processing failed',
  'request.queued': 'Request accepted',
  'request.rejected': 'Request rejected',
  'request.succeeded': 'Request completed',
};

const STATUS_LABELS: Readonly<Record<WebhookDelivery['status'], string>> = {
  dead: 'Needs attention',
  delivered: 'Delivered',
  delivering: 'Sending now',
  pending: 'Scheduled',
  retry: 'Will retry',
};

function sentenceFromCode(value: string): string {
  const words = value.replaceAll(/[._-]+/gu, ' ').trim();
  if (words === '') return 'System update';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function webhookEventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? sentenceFromCode(eventType);
}

export function webhookDeliveryStatusLabel(status: WebhookDelivery['status']): string {
  return STATUS_LABELS[status];
}

export function deliveryAttemptLabel(attemptCount: number): string {
  if (attemptCount === 0) return 'Not tried yet';
  return `${String(attemptCount)} ${attemptCount === 1 ? 'try' : 'tries'}`;
}

export function nextDeliveryAttemptAt(
  delivery: Pick<WebhookDelivery, 'nextAttemptAt' | 'status'>,
): string | null {
  if (delivery.status === 'delivered' || delivery.status === 'dead') return null;
  return delivery.nextAttemptAt;
}

export function receiverReplyLabel(statusCode: number | null): string {
  if (statusCode === null) return 'No reply yet';
  if (statusCode === 200) return 'Accepted · HTTP 200';
  if (statusCode === 201) return 'Created · HTTP 201';
  if (statusCode === 202) return 'Accepted for processing · HTTP 202';
  if (statusCode === 204) return 'Accepted, no content · HTTP 204';
  if (statusCode >= 200 && statusCode < 300) return `Accepted · HTTP ${String(statusCode)}`;
  if (statusCode >= 300 && statusCode < 400) return `Redirect refused · HTTP ${String(statusCode)}`;
  if (statusCode >= 400 && statusCode < 500)
    return `Receiver rejected it · HTTP ${String(statusCode)}`;
  if (statusCode >= 500) return `Receiver reported an error · HTTP ${String(statusCode)}`;
  return `Receiver replied · HTTP ${String(statusCode)}`;
}

export interface DeliveryPageCounts {
  readonly attention: number;
  readonly delivered: number;
  readonly moving: number;
}

export function deliveryPageCounts(
  deliveries: readonly Pick<WebhookDelivery, 'status'>[],
): DeliveryPageCounts {
  return deliveries.reduce<DeliveryPageCounts>(
    (counts, delivery) => ({
      attention: counts.attention + (delivery.status === 'dead' ? 1 : 0),
      delivered: counts.delivered + (delivery.status === 'delivered' ? 1 : 0),
      moving:
        counts.moving + (['pending', 'delivering', 'retry'].includes(delivery.status) ? 1 : 0),
    }),
    { attention: 0, delivered: 0, moving: 0 },
  );
}

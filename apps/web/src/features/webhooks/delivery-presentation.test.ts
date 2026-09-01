import { describe, expect, it } from 'vitest';

import {
  deliveryAttemptLabel,
  deliveryPageCounts,
  initialDeliverySection,
  nextDeliveryAttemptAt,
  receiverReplyLabel,
  webhookDeliveryStatusLabel,
  webhookEventLabel,
} from './delivery-presentation';

describe('webhook delivery presentation', () => {
  it('opens the section promised by each role workspace', () => {
    expect(initialDeliverySection(true)).toBe('endpoints');
    expect(initialDeliverySection(false)).toBe('deliveries');
  });

  it('translates known events and states into user language', () => {
    expect(webhookEventLabel('request.succeeded')).toBe('Request completed');
    expect(webhookDeliveryStatusLabel('dead')).toBe('Needs attention');
    expect(deliveryAttemptLabel(1)).toBe('1 try');
    expect(deliveryAttemptLabel(3)).toBe('3 tries');
  });

  it('keeps an understandable fallback for new event types', () => {
    expect(webhookEventLabel('invoice.export_ready')).toBe('Invoice export ready');
  });

  it('explains receiver responses without hiding the HTTP code', () => {
    expect(receiverReplyLabel(null)).toBe('No reply yet');
    expect(receiverReplyLabel(202)).toBe('Accepted for processing · HTTP 202');
    expect(receiverReplyLabel(422)).toBe('Receiver rejected it · HTTP 422');
    expect(receiverReplyLabel(503)).toBe('Receiver reported an error · HTTP 503');
  });

  it('shows a next attempt only while delivery work is nonterminal', () => {
    const scheduledAt = '2026-08-25T08:00:00.000Z';

    expect(nextDeliveryAttemptAt({ nextAttemptAt: scheduledAt, status: 'pending' })).toBe(
      scheduledAt,
    );
    expect(nextDeliveryAttemptAt({ nextAttemptAt: scheduledAt, status: 'delivering' })).toBe(
      scheduledAt,
    );
    expect(nextDeliveryAttemptAt({ nextAttemptAt: scheduledAt, status: 'retry' })).toBe(
      scheduledAt,
    );
    expect(nextDeliveryAttemptAt({ nextAttemptAt: scheduledAt, status: 'delivered' })).toBeNull();
    expect(nextDeliveryAttemptAt({ nextAttemptAt: scheduledAt, status: 'dead' })).toBeNull();
    expect(nextDeliveryAttemptAt({ nextAttemptAt: null, status: 'pending' })).toBeNull();
  });

  it('summarizes only the exact delivery states supplied for the loaded page', () => {
    expect(
      deliveryPageCounts([
        { status: 'delivered' },
        { status: 'retry' },
        { status: 'pending' },
        { status: 'dead' },
      ]),
    ).toEqual({ attention: 1, delivered: 1, moving: 2 });
  });
});

import { describe, expect, it } from 'vitest';

import {
  deliveryAttemptLabel,
  receiverReplyLabel,
  webhookDeliveryStatusLabel,
  webhookEventLabel,
} from './delivery-presentation';

describe('webhook delivery presentation', () => {
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
});

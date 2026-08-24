import { createHmac, randomUUID } from 'node:crypto';

import { signWebhook, webhookSignaturePayload } from './webhook-signing.js';

describe('outbound webhook signing', () => {
  it('binds event id, timestamp, attempt number, and exact raw bytes', () => {
    const input = {
      attempt: 3,
      eventId: randomUUID(),
      rawBody: Buffer.from('{"b":2,"a":1}', 'utf8'),
      secret: 'worker-test-secret-that-is-at-least-32-characters',
      timestamp: 1_700_000_000,
    };
    const expected = createHmac('sha256', input.secret)
      .update(
        Buffer.concat([
          Buffer.from(`${input.eventId}.${input.timestamp}.${input.attempt}.`, 'utf8'),
          input.rawBody,
        ]),
      )
      .digest('hex');

    expect(webhookSignaturePayload(input)).toEqual(
      Buffer.concat([
        Buffer.from(`${input.eventId}.${input.timestamp}.${input.attempt}.`, 'utf8'),
        input.rawBody,
      ]),
    );
    expect(signWebhook(input)).toBe(`sha256=${expected}`);
    expect(signWebhook({ ...input, attempt: 4 })).not.toBe(`sha256=${expected}`);
  });
});

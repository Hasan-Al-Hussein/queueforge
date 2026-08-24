import { randomUUID } from 'node:crypto';

import { createOutboundSignature, verifyOutboundSignature } from './signature.js';

describe('outbound webhook signature verification', () => {
  it('accepts the exact signed bytes and rejects tampering without throwing', () => {
    const input = {
      attempt: 2,
      eventId: randomUUID(),
      rawBody: Buffer.from('{"value":1}', 'utf8'),
      secret: 'sink-test-secret-that-is-at-least-32-characters',
      timestamp: 1_700_000_000,
    };
    const signature = createOutboundSignature(input);

    expect(verifyOutboundSignature(signature, input)).toBe(true);
    expect(
      verifyOutboundSignature(signature, {
        ...input,
        rawBody: Buffer.from('{"value":2}', 'utf8'),
      }),
    ).toBe(false);
    expect(verifyOutboundSignature('sha256=short', input)).toBe(false);
  });
});

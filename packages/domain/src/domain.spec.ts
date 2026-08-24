import type { WorkflowRequestStatus } from '@queueforge/contracts';

import {
  allowedRequestTransitions,
  assertRequestTransition,
  canonicalJson,
  computeRetryDelayMs,
  createIdempotencyFingerprint,
  hashJson,
  sanitizeAuditMetadata,
  shouldDeadLetter,
  validatePayload,
} from './index.js';

describe('request state machine', () => {
  const statuses: WorkflowRequestStatus[] = [
    'received',
    'validation_failed',
    'pending_approval',
    'approved',
    'rejected',
    'queued',
    'processing',
    'succeeded',
    'failed',
    'dead_lettered',
    'cancelled',
  ];

  it('exposes a transition row for every status', () => {
    expect(statuses.map((status) => allowedRequestTransitions(status))).toHaveLength(
      statuses.length,
    );
  });

  it('requires an explicit manual-retry policy for dead letters', () => {
    expect(() => assertRequestTransition('dead_lettered', 'queued')).toThrow('cannot transition');
    expect(() =>
      assertRequestTransition('dead_lettered', 'queued', { manualRetry: true }),
    ).not.toThrow();
  });

  it('rejects illegal terminal transitions', () => {
    expect(() => assertRequestTransition('succeeded', 'processing')).toThrow('cannot transition');
  });
});

describe('canonical data', () => {
  it('hashes equivalent object key orders identically', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('binds idempotency to principal and operation', () => {
    const request = { payload: { amount: 42 } };
    const first = createIdempotencyFingerprint({ operation: 'submit', principalId: 'a', request });
    const second = createIdempotencyFingerprint({ operation: 'submit', principalId: 'b', request });
    expect(first).not.toBe(second);
  });

  it('rejects non-JSON values', () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow('Non-finite');
  });
});

describe('domain policies', () => {
  it('computes bounded exponential backoff with deterministic jitter', () => {
    const policy = { baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0.2, maxAttempts: 3 };
    expect(computeRetryDelayMs(1, policy, () => 0)).toBe(80);
    expect(computeRetryDelayMs(4, policy, () => 1)).toBe(600);
    expect(shouldDeadLetter(3, policy)).toBe(true);
  });

  it('validates JSON schema without coercing payloads', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['amount'],
      properties: { amount: { type: 'number', minimum: 1 } },
    };
    expect(validatePayload(schema, { amount: 42 }).valid).toBe(true);
    expect(validatePayload(schema, { amount: '42' }).valid).toBe(false);
    expect(() => validatePayload({ type: 'not-a-json-schema-type' }, {})).toThrow(
      'Request schema is not a supported JSON Schema',
    );
  });

  it('redacts and bounds audit metadata', () => {
    expect(
      sanitizeAuditMetadata({ password: 'never-log-me', nested: { accessToken: 'nope' } }),
    ).toEqual({ nested: { accessToken: '[redacted]' }, password: '[redacted]' });
  });
});

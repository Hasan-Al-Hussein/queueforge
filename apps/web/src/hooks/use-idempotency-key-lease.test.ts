import { describe, expect, it, vi } from 'vitest';

import { IdempotencyKeyLease } from './use-idempotency-key-lease';

describe('IdempotencyKeyLease', () => {
  it('retains the key across an uncertain retry of the same logical input', () => {
    const createKey = vi.fn().mockReturnValueOnce('key-1');
    const lease = new IdempotencyKeyLease(createKey);

    const firstAttempt = lease.acquire('request-a');
    const retryAfterLostResponse = lease.acquire('request-a');

    expect(retryAfterLostResponse).toBe(firstAttempt);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it('rotates only after input changes or the action is definitively cleared', () => {
    const createKey = vi
      .fn<() => string>()
      .mockReturnValueOnce('key-1')
      .mockReturnValueOnce('key-2')
      .mockReturnValueOnce('key-3');
    const lease = new IdempotencyKeyLease(createKey);

    expect(lease.acquire('request-a')).toBe('key-1');
    lease.clearIfInputChanged('request-b');
    expect(lease.acquire('request-b')).toBe('key-2');
    lease.clear();
    expect(lease.acquire('request-b')).toBe('key-3');
  });
});

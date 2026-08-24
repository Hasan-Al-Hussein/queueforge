import { boundedExponentialBackoff } from './backoff.js';

describe('bounded exponential backoff', () => {
  it('grows exponentially and applies deterministic bounded jitter', () => {
    const policy = { baseDelayMs: 1_000, jitterRatio: 0.2, maxDelayMs: 10_000 };

    expect(boundedExponentialBackoff(1, policy, () => 0)).toBe(800);
    expect(boundedExponentialBackoff(2, policy, () => 0.5)).toBe(2_000);
    expect(boundedExponentialBackoff(20, policy, () => 1)).toBe(10_000);
  });

  it('rejects invalid attempts, policies, and random sources', () => {
    expect(() => boundedExponentialBackoff(0)).toThrow(RangeError);
    expect(() =>
      boundedExponentialBackoff(1, {
        baseDelayMs: 1_000,
        jitterRatio: 1.1,
        maxDelayMs: 10_000,
      }),
    ).toThrow(RangeError);
    expect(() => boundedExponentialBackoff(1, undefined, () => 2)).toThrow(RangeError);
  });
});

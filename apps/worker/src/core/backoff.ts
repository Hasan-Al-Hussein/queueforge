export interface BackoffPolicy {
  readonly baseDelayMs: number;
  readonly jitterRatio: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = Object.freeze({
  baseDelayMs: 1_000,
  jitterRatio: 0.2,
  maxDelayMs: 60_000,
});

export function boundedExponentialBackoff(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError('Attempt must be a positive integer');
  }
  if (
    !Number.isFinite(policy.baseDelayMs) ||
    policy.baseDelayMs < 1 ||
    !Number.isFinite(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs ||
    !Number.isFinite(policy.jitterRatio) ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  ) {
    throw new RangeError('Invalid backoff policy');
  }

  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new RangeError('Random source must return a value between zero and one');
  }

  const exponent = Math.min(attempt - 1, 30);
  const exponentialDelay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
  const lowerBound = exponentialDelay * (1 - policy.jitterRatio);
  const upperBound = Math.min(policy.maxDelayMs, exponentialDelay * (1 + policy.jitterRatio));
  return Math.round(lowerBound + randomValue * (upperBound - lowerBound));
}

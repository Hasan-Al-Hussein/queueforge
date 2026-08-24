import { DomainError } from './errors.js';

export interface RetryPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
  readonly maxAttempts: number;
}

export const defaultRetryPolicy: RetryPolicy = Object.freeze({
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
  maxAttempts: 5,
});

export function validateRetryPolicy(policy: RetryPolicy): void {
  if (
    !Number.isInteger(policy.baseDelayMs) ||
    policy.baseDelayMs < 1 ||
    !Number.isInteger(policy.maxDelayMs) ||
    policy.maxDelayMs < policy.baseDelayMs ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 1
  ) {
    throw new DomainError('INVALID_RETRY_POLICY', 'Retry policy is invalid');
  }
}

export function computeRetryDelayMs(
  attempt: number,
  policy: RetryPolicy = defaultRetryPolicy,
  random: () => number = Math.random,
): number {
  validateRetryPolicy(policy);
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new DomainError('INVALID_RETRY_POLICY', 'Attempt must be a positive integer');
  }
  const capped = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  const normalizedRandom = Math.min(1, Math.max(0, random()));
  const jitter = (normalizedRandom * 2 - 1) * policy.jitterRatio;
  return Math.max(1, Math.round(capped * (1 + jitter)));
}

export function shouldDeadLetter(
  attempt: number,
  policy: RetryPolicy = defaultRetryPolicy,
): boolean {
  validateRetryPolicy(policy);
  return attempt >= policy.maxAttempts;
}

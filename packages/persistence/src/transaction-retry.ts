import { randomInt } from 'node:crypto';

import type { DataSource, EntityManager } from 'typeorm';

const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);
const DEFAULT_MAX_ATTEMPTS = 7;
const MAX_BACKOFF_MS = 250;
type SupportedIsolation = 'READ COMMITTED' | 'SERIALIZABLE';

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== 'object') {
    return null;
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code;
  }
  if (
    'driverError' in error &&
    error.driverError !== null &&
    typeof error.driverError === 'object' &&
    'code' in error.driverError &&
    typeof error.driverError.code === 'string'
  ) {
    return error.driverError.code;
  }
  return null;
}

async function withTransactionRetry<T>(
  dataSource: DataSource,
  isolation: SupportedIsolation,
  operation: (manager: EntityManager) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await dataSource.transaction(isolation, operation);
    } catch (error) {
      if (!RETRYABLE_SQLSTATES.has(errorCode(error) ?? '') || attempt >= maxAttempts) {
        throw error;
      }
      const backoffCeiling = Math.min(MAX_BACKOFF_MS, 10 * 2 ** (attempt - 1));
      await new Promise<void>((resolve) => {
        setTimeout(resolve, randomInt(5, backoffCeiling + 1));
      });
    }
  }
  throw new Error('Database transaction retry limit was exhausted');
}

export function withSerializableRetry<T>(
  dataSource: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  return withTransactionRetry(dataSource, 'SERIALIZABLE', operation, maxAttempts);
}

export function withReadCommittedRetry<T>(
  dataSource: DataSource,
  operation: (manager: EntityManager) => Promise<T>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  return withTransactionRetry(dataSource, 'READ COMMITTED', operation, maxAttempts);
}

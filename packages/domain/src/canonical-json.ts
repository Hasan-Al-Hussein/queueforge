import { createHash } from 'node:crypto';

import type { JsonObject } from '@queueforge/contracts';
import { canonicalize } from 'json-canonicalize';

import { DomainError } from './errors.js';

function assertJsonCompatible(value: unknown, path = '$'): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DomainError('INVALID_JSON_VALUE', `Non-finite number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonCompatible(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new DomainError('INVALID_JSON_VALUE', `Non-plain object at ${path}`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') {
        throw new DomainError('INVALID_JSON_VALUE', `Unsupported value at ${path}.${key}`);
      }
      assertJsonCompatible(entry, `${path}.${key}`);
    }
    return;
  }
  throw new DomainError('INVALID_JSON_VALUE', `Unsupported value at ${path}`);
}

export function canonicalJson(value: unknown): string {
  assertJsonCompatible(value);
  return canonicalize(value);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export interface IdempotencyFingerprintInput {
  readonly operation: string;
  readonly principalId: string;
  readonly request: JsonObject;
}

export function createIdempotencyFingerprint(input: IdempotencyFingerprintInput): string {
  return hashJson({
    operation: input.operation,
    principalId: input.principalId,
    request: input.request,
  });
}

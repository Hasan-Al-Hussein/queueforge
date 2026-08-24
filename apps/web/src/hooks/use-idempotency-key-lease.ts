import { useCallback, useEffect, useState } from 'react';

import { newIdempotencyKey } from '../api/client';

type KeyFactory = () => string;

/**
 * Retains one idempotency key for one logical input until the caller records a
 * definitive success/cancel or the input changes. Transport failures do not
 * mutate the lease, so an operator retry converges on the original command.
 */
export class IdempotencyKeyLease {
  private current: { readonly inputSignature: string; readonly key: string } | null = null;

  public constructor(private readonly createKey: KeyFactory = newIdempotencyKey) {}

  public acquire(inputSignature: string): string {
    if (this.current?.inputSignature !== inputSignature) {
      this.current = { inputSignature, key: this.createKey() };
    }
    return this.current.key;
  }

  public clear(): void {
    this.current = null;
  }

  public clearIfInputChanged(inputSignature: string): void {
    if (this.current !== null && this.current.inputSignature !== inputSignature) this.clear();
  }
}

export interface IdempotencyKeyLeaseHandle {
  /** Acquire or reuse the key for the current logical input. */
  readonly acquire: () => string;
  /** Clear only after definitive success or an explicit user cancellation. */
  readonly clear: () => void;
}

export function useIdempotencyKeyLease(inputSignature: string): IdempotencyKeyLeaseHandle {
  const [lease] = useState(() => new IdempotencyKeyLease());

  useEffect(() => lease.clearIfInputChanged(inputSignature), [inputSignature, lease]);

  const acquire = useCallback(() => lease.acquire(inputSignature), [inputSignature, lease]);
  const clear = useCallback(() => lease.clear(), [lease]);
  return { acquire, clear };
}

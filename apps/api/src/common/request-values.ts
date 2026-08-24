import { ApplicationError } from '@queueforge/application';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;

export function requireIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new ApplicationError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required',
    );
  }
  return value;
}

export function requireHeader(value: string | undefined, headerName: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new ApplicationError('VALIDATION_FAILED', `${headerName} header is required`);
  }
  return value;
}

export function assertTrustedOrigin(origin: string | undefined, expectedOrigin: string): void {
  if (origin !== expectedOrigin) {
    throw new ApplicationError('CSRF_VALIDATION_FAILED', 'Request origin is not trusted');
  }
}

export function sourceIp(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const first = value.split(',', 1)[0]?.trim();
  return first !== undefined && first !== '' && first.length <= 64 ? first : null;
}

export interface PageEnvelope<T> {
  readonly items: readonly T[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
}

export function toPage<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
  totalItems = items.length,
): PageEnvelope<T> {
  return {
    items,
    meta: {
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    },
  };
}

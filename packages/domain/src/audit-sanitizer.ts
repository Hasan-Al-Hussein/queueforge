const SENSITIVE_KEYS = /authorization|cookie|password|secret|signature|token|api[_-]?key/i;
const MAX_DEPTH = 5;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

export type SafeAuditValue =
  | null
  | boolean
  | number
  | string
  | readonly SafeAuditValue[]
  | { readonly [key: string]: SafeAuditValue };

export function sanitizeAuditMetadata(value: unknown, depth = 0): SafeAuditValue {
  if (depth >= MAX_DEPTH) {
    return '[depth-limit]';
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[non-finite]';
  }
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeAuditMetadata(entry, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, MAX_ARRAY_ITEMS)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEYS.test(key) ? '[redacted]' : sanitizeAuditMetadata(entry, depth + 1),
        ]),
    );
  }
  return '[unsupported]';
}

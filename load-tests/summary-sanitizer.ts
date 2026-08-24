const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token)/i;
const JWT_VALUE = /(?:^|\s|["'])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:$|\s|["'])/;

export function sanitizeSummaryJson(summary: unknown): string {
  return JSON.stringify(
    summary,
    (key, value: unknown) => {
      if (key === 'setup_data') {
        return undefined;
      }
      if (SENSITIVE_KEY.test(key)) {
        return '[redacted]';
      }
      if (typeof value === 'string' && JWT_VALUE.test(value)) {
        return '[redacted]';
      }
      return value;
    },
    2,
  );
}

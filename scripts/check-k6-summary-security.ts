import assert from 'node:assert/strict';

import { sanitizeSummaryJson } from '../load-tests/summary-sanitizer.ts';

const syntheticJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.synthetic-signature';
const sanitized = sanitizeSummaryJson({
  metrics: { http_reqs: { count: 1 } },
  nested: {
    authorization: `Bearer ${syntheticJwt}`,
    refreshToken: syntheticJwt,
    safe: 'retained',
  },
  setup_data: {
    adminToken: syntheticJwt,
    approverToken: syntheticJwt,
  },
});
const parsed = JSON.parse(sanitized) as Record<string, unknown>;

assert.equal(Object.hasOwn(parsed, 'setup_data'), false, 'setup_data must not be persisted');
assert.equal(sanitized.includes(syntheticJwt), false, 'JWT-shaped values must be redacted');
assert.equal(sanitized.includes('Bearer eyJ'), false, 'Bearer credentials must be redacted');
assert.equal(
  (parsed.nested as Record<string, unknown>).safe,
  'retained',
  'non-sensitive summary data must remain available',
);

process.stdout.write('k6 summary credential-redaction regression passed\n');

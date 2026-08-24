import { SENSITIVE_LOG_PATHS } from './observability.module';

describe('structured log redaction', () => {
  it('covers HTTP, webhook, CSRF, idempotency, and GraphQL credential surfaces', () => {
    expect(SENSITIVE_LOG_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["idempotency-key"]',
        'req.headers["x-csrf-token"]',
        'req.headers["x-queueforge-signature"]',
        'req.body.apiKey',
        'req.body.initialPassword',
        'req.body.password',
        'req.body.variables.idempotencyKey',
        'req.body.variables.initialPassword',
        'req.body.variables.password',
        'res.headers.set-cookie',
      ]),
    );
  });
});

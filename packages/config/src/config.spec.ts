import {
  EnvironmentValidationError,
  loadPublicWebEnvironment,
  loadRuntimeEnvironment,
  loadWorkerEnvironment,
  splitCommaSeparated,
} from './index.js';

const validRuntimeEnvironment = {
  DATABASE_URL: 'postgresql://queueforge:password@127.0.0.1:5432/queueforge',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
  WEBHOOK_MASTER_KEY: `${'A'.repeat(43)}=`,
  BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
  BOOTSTRAP_ADMIN_PASSWORD: 'correct-horse-battery-staple',
};

describe('environment validation', () => {
  it('parses false without JavaScript truthiness coercion', () => {
    expect(
      loadRuntimeEnvironment({ ...validRuntimeEnvironment, COOKIE_SECURE: 'false' }).COOKIE_SECURE,
    ).toBe(false);
  });

  it('rejects missing secrets', () => {
    expect(() =>
      loadRuntimeEnvironment({ ...validRuntimeEnvironment, JWT_ACCESS_SECRET: undefined }),
    ).toThrow(EnvironmentValidationError);
  });

  it('keeps server-only variables out of the public web result', () => {
    const result = loadPublicWebEnvironment({
      ...validRuntimeEnvironment,
      NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
      NEXT_PUBLIC_GRAPHQL_URL: 'http://127.0.0.1:3001/graphql',
      NEXT_PUBLIC_CSRF_COOKIE_NAME: 'custom_csrf',
    });
    expect(result).not.toHaveProperty('JWT_ACCESS_SECRET');
    expect(result.NEXT_PUBLIC_CSRF_COOKIE_NAME).toBe('custom_csrf');
  });

  it('keeps API and bootstrap credentials out of the worker configuration', () => {
    const result = loadWorkerEnvironment({
      ...validRuntimeEnvironment,
      BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-secret',
      JWT_ACCESS_SECRET: 'jwt-secret-that-must-not-enter-the-worker',
    });
    expect(result).not.toHaveProperty('BOOTSTRAP_ADMIN_PASSWORD');
    expect(result).not.toHaveProperty('JWT_ACCESS_SECRET');
    expect(result).not.toHaveProperty('REFRESH_TOKEN_PEPPER');
    expect(result).toHaveProperty('WEBHOOK_MASTER_KEY');
  });

  it('keeps bootstrap credentials out of the long-running API configuration', () => {
    const result = loadRuntimeEnvironment(validRuntimeEnvironment);
    expect(result).not.toHaveProperty('BOOTSTRAP_ADMIN_EMAIL');
    expect(result).not.toHaveProperty('BOOTSTRAP_ADMIN_PASSWORD');
  });

  it('normalizes comma-separated allowlists', () => {
    expect(splitCommaSeparated(' Localhost, 127.0.0.1,LOCALHOST ')).toEqual([
      'localhost',
      '127.0.0.1',
      'localhost',
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.CI !== 'true') {
  const environmentPath = resolve(__dirname, '..', '..', '.env');
  try {
    process.loadEnvFile(environmentPath);
    // Jest provides a sandboxed process.env object that Node's loader does not
    // mutate consistently, so fill only still-missing values from the same file.
    for (const rawLine of readFileSync(environmentPath, 'utf8').split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) {
        continue;
      }
      const separator = line.indexOf('=');
      if (separator <= 0) {
        continue;
      }
      const name = line.slice(0, separator).trim();
      if (/^[A-Z][A-Z0-9_]*$/u.test(name) && process.env[name] === undefined) {
        process.env[name] = line.slice(separator + 1);
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

Object.assign(process.env, { APP_MODE: 'test', NODE_ENV: 'test' });
// These fallbacks are deliberately public, synthetic isolated-test credentials.
// secretlint-disable
process.env['DATABASE_URL'] =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://queueforge_app:queueforge_test_only@127.0.0.1:55432/queueforge_test';
process.env['MIGRATION_DATABASE_URL'] =
  process.env.TEST_MIGRATION_DATABASE_URL ??
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://queueforge_owner:queueforge_test_only@127.0.0.1:55432/queueforge_test';
// secretlint-enable
process.env['REDIS_URL'] =
  process.env.TEST_REDIS_URL ??
  process.env.REDIS_URL ??
  'redis://:queueforge_test_only@127.0.0.1:56379/0';
process.env['JWT_ACCESS_SECRET'] ??= 'queueforge-test-jwt-secret-that-is-not-used-outside-tests';
process.env['REFRESH_TOKEN_PEPPER'] ??=
  'queueforge-test-refresh-pepper-that-is-not-used-outside-tests';
process.env['WEBHOOK_MASTER_KEY'] ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env['BOOTSTRAP_ADMIN_EMAIL'] ??= 'admin@queueforge.test';
process.env['BOOTSTRAP_ADMIN_PASSWORD'] ??= 'synthetic-test-password-only';
process.env['SINK_SECRET'] ??= 'queueforge-test-sink-secret-that-is-not-used-outside-tests';

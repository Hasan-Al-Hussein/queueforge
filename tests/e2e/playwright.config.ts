import { defineConfig, devices } from '@playwright/test';

const webOrigin = (
  process.env.E2E_BASE_URL ??
  process.env.WEB_ORIGIN ??
  'http://127.0.0.1:3100'
).replace(/\/$/, '');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 1 : 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e' }]],
  outputDir: 'test-results/e2e',
  use: {
    ...devices['Desktop Chrome'],
    actionTimeout: 15_000,
    baseURL: webOrigin,
    navigationTimeout: 30_000,
    screenshot: 'off',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
});

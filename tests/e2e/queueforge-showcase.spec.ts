import { expect, test, type Page, type Request } from '@playwright/test';

test.skip(
  process.env['QF_SHOWCASE_E2E'] !== 'true',
  'Run only against the separately built public showcase artifact.',
);

interface BrowserEvidence {
  readonly consoleErrors: string[];
  readonly requests: Request[];
}

function collectEvidence(page: Page): BrowserEvidence {
  const consoleErrors: string[] = [];
  const requests: Request[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => requests.push(request));
  return { consoleErrors, requests };
}

function expectStaticOnly(evidence: BrowserEvidence): void {
  const forbidden = evidence.requests.filter((request) => {
    const url = new URL(request.url());
    return (
      request.method() !== 'GET' ||
      /\/(?:api|graphql)(?:[/?#]|$)/iu.test(url.pathname) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname)
    );
  });
  expect(
    forbidden.map((request) => `${request.method()} ${request.url()}`),
    'The public showcase must load same-origin static resources only.',
  ).toEqual([]);
  expect(evidence.consoleErrors).toEqual([]);
}

test('a recruiter can explore every administrative surface without a backend', async ({
  page,
}, testInfo) => {
  const evidence = collectEvidence(page);
  await page.goto('/login/');

  await expect(page.getByRole('heading', { name: 'Explore QueueForge' })).toBeVisible();
  await expect(page.locator('[data-public-demo-disclosure]')).toHaveText(
    'Public portfolio demo with synthetic data. No uploads, persistence, live AI, or real-world actions.',
  );
  await expect(page.getByRole('button', { name: /Explore as administrator/ })).toBeVisible();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('showcase-login.png') });

  await page.getByRole('button', { name: /Explore as administrator/ }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole('heading', { name: 'Admin overview' })).toBeVisible();
  await expect(page.getByText('Interactive portfolio showcase', { exact: true })).toBeVisible();
  await expect(page.locator('[data-public-demo-disclosure]')).toContainText(
    'No uploads, persistence, live AI, or real-world actions.',
  );
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('showcase-admin.png') });

  const routes = [
    ['Request types', '/workflows/', 'Request types'],
    ['Delivery connections', '/webhooks/', 'Delivery'],
    ['People & access', '/team/', 'Team & access'],
    ['Processing health', '/operations/', 'Processing'],
    ['Activity log', '/audit/', 'Activity log'],
    ['Notifications', '/notifications/', 'Notifications'],
  ] as const;

  for (const [linkName, path, heading] of routes) {
    await page.getByRole('link', { name: linkName, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`, 'u'));
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
  }

  await page.getByLabel('Explore role').selectOption({ label: 'Approver view' });
  await expect(page.getByRole('heading', { name: 'Approval overview' })).toBeVisible();
  await page.getByRole('link', { name: 'Approval inbox', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decisions waiting for you' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Approve this request?' })).toBeVisible();
  await page.getByLabel('Note for the requester').fill('Approved in the browser-only walkthrough.');
  await page.getByRole('button', { name: 'Approve request', exact: true }).click();
  await expect(
    page.getByText('Request approved. QueueForge will start the next step.'),
  ).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies).toEqual([]);
  expectStaticOnly(evidence);
});

test('the public entry and operator workspace fit a 390px viewport', async ({ page }) => {
  const evidence = collectEvidence(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/login/');

  await expect(page.getByRole('button', { name: /Explore as operator/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.getByRole('button', { name: /Explore as operator/ }).click();
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(page.getByRole('dialog', { name: 'Application navigation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start & track requests' })).toBeVisible();

  expectStaticOnly(evidence);
});

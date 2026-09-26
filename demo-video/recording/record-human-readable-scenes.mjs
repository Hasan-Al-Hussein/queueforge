import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { chromium, expect } from '@playwright/test';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const VIEWPORT = { width: 1440, height: 900 };
const WORKSPACE_NAME = 'Foundry Demonstration';
const WORKFLOW_NAME = 'Expense review';
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? 'operator@queueforge.local';
const APPROVER_EMAIL = process.env.E2E_APPROVER_EMAIL ?? 'approver@queueforge.local';
const TAKE_ID =
  process.argv.find((argument) => argument.startsWith('--take='))?.slice('--take='.length) ??
  'human-readable-search-tour-20260831-a';
const RESUME = process.argv.includes('--resume');
const SUPPLEMENTS_ONLY = process.argv.includes('--supplements-only');
const TOUR_CONTRACT_ONLY = process.argv.includes('--tour-contract-only');
const WORKFLOW_CONTRACT_ONLY = process.argv.includes('--workflow-contract-only');
const ROLE_ONLY = process.argv.includes('--role-only');
const TAKE_ROOT = resolve(import.meta.dirname, 'takes', TAKE_ID);
const RAW_ROOT = join(TAKE_ROOT, '.raw');
const METADATA_PATH = join(TAKE_ROOT, 'metadata.private.json');
const TRUTH_REPORT_PATH = join(TAKE_ROOT, 'search-truth.json');
const SUMMARY = 'Dubai client workshop airfare — September 2026';
const APPROVAL_SEARCH = 'Dubai client workshop airfare';

const SEARCH_QUERIES = {
  approvals: ['Expense review', 'Dubai client workshop', 'Omar', 'Request approved'],
  deliveries: ['Expense review', 'Dubai client workshop', 'Omar', 'Request completed', 'Delivered'],
  audit: ['Expense review', 'Dubai client workshop', 'Omar', 'Request completed'],
};

const metadata = {
  takeId: TAKE_ID,
  createdAt: new Date().toISOString(),
  workspace: WORKSPACE_NAME,
  workflow: WORKFLOW_NAME,
  summary: SUMMARY,
  requestId: null,
  correlationId: null,
  status: 'initializing',
  clips: [],
};

function parseEnv(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function safeError(error, secret) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return secret.length > 0 ? message.replaceAll(secret, '[redacted]') : message;
}

function compactText(value) {
  return value.replace(/\s+/gu, ' ').trim().slice(0, 220);
}

function assertLoopbackOrigin(value) {
  const { hostname } = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('The recording origin must remain loopback-only');
  }
}

async function persistMetadata() {
  await mkdir(TAKE_ROOT, { recursive: true });
  await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function hasRecordedClip(name) {
  return metadata.clips.some((clip) => clip.name === name);
}

async function installVideoOverlay(page) {
  await page.evaluate(() => {
    if (document.querySelector('[data-qf-video-pointer]')) return;
    const style = document.createElement('style');
    style.dataset.qfVideoOverlay = 'true';
    style.textContent = `
      [data-qf-video-pointer] {
        position: fixed; left: 42px; top: 42px; width: 25px; height: 31px;
        z-index: 2147483647; pointer-events: none;
        filter: drop-shadow(0 3px 5px rgb(0 0 0 / .34));
        transform: translate(-4px, -3px);
        transition: left 320ms cubic-bezier(.22,.8,.24,1), top 320ms cubic-bezier(.22,.8,.24,1);
      }
      [data-qf-video-pointer] svg { display: block; width: 100%; height: 100%; }
      [data-qf-video-pointer]::after {
        content: ''; position: absolute; left: 0; top: 0; width: 26px; height: 26px;
        border: 2px solid #e4a84b; border-radius: 999px; opacity: 0;
        transform: translate(-8px, -8px) scale(.35);
      }
      [data-qf-video-pointer].is-clicking::after {
        animation: qf-video-click 460ms cubic-bezier(.16,.78,.22,1);
      }
      @keyframes qf-video-click {
        0% { opacity: .95; transform: translate(-8px, -8px) scale(.35); }
        100% { opacity: 0; transform: translate(-8px, -8px) scale(1.35); }
      }
      [data-qf-video-chapter] {
        position: fixed; left: 50%; bottom: 30px; z-index: 2147483646;
        pointer-events: none; max-width: min(660px, calc(100vw - 48px));
        padding: 10px 16px 11px; border: 1px solid rgb(228 168 75 / .58);
        border-radius: 9px; background: rgb(5 13 17 / .94);
        box-shadow: 0 12px 34px rgb(0 0 0 / .28), inset 0 1px rgb(255 255 255 / .08);
        color: #f5f1e8; font: 650 14px/1.25 system-ui, sans-serif;
        letter-spacing: .01em; opacity: 0; transform: translate(-50%, 8px);
        transition: opacity 220ms ease, transform 260ms cubic-bezier(.22,.8,.24,1);
      }
      [data-qf-video-chapter].is-visible { opacity: 1; transform: translate(-50%, 0); }
      [data-qf-video-chapter] b { color: #e4a84b; font-weight: 750; margin-right: 8px; }
    `;
    document.head.append(style);
    const pointer = document.createElement('div');
    pointer.dataset.qfVideoPointer = 'true';
    pointer.setAttribute('aria-hidden', 'true');
    pointer.innerHTML = `
      <svg viewBox="0 0 25 31" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 2.5V24.4L8.9 18.8L13.2 28.2L17.2 26.3L12.9 17H21L3 2.5Z" fill="#F8F7F2" stroke="#071216" stroke-width="2.2" stroke-linejoin="round"/>
      </svg>`;
    document.body.append(pointer);
  });
}

async function showChapter(page, step, message, hold = 1450) {
  await installVideoOverlay(page);
  await page.evaluate(
    ({ stepLabel, text }) => {
      let chapter = document.querySelector('[data-qf-video-chapter]');
      if (!(chapter instanceof HTMLElement)) {
        chapter = document.createElement('div');
        chapter.dataset.qfVideoChapter = 'true';
        document.body.append(chapter);
      }
      chapter.innerHTML = `<b>${stepLabel}</b>${text}`;
      chapter.classList.add('is-visible');
    },
    { stepLabel: step, text: message },
  );
  await page.waitForTimeout(hold);
  await page.evaluate(() => {
    document.querySelector('[data-qf-video-chapter]')?.classList.remove('is-visible');
  });
  await page.waitForTimeout(300);
}

async function movePointerTo(page, locator, options = {}) {
  const { xRatio = 0.5, yRatio = 0.5, hold = 360 } = options;
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 20_000 });
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Could not resolve target geometry');
  await installVideoOverlay(page);
  await page.evaluate(
    ({ left, top }) => {
      const pointer = document.querySelector('[data-qf-video-pointer]');
      if (!(pointer instanceof HTMLElement)) return;
      pointer.style.left = `${String(left)}px`;
      pointer.style.top = `${String(top)}px`;
    },
    { left: box.x + box.width * xRatio, top: box.y + box.height * yRatio },
  );
  await page.waitForTimeout(hold);
}

async function pulsePointer(page) {
  await page.evaluate(() => {
    const pointer = document.querySelector('[data-qf-video-pointer]');
    if (!(pointer instanceof HTMLElement)) return;
    pointer.classList.remove('is-clicking');
    void pointer.offsetWidth;
    pointer.classList.add('is-clicking');
  });
  await page.waitForTimeout(120);
}

async function clickWithPointer(page, locator, after = 700) {
  await movePointerTo(page, locator);
  await pulsePointer(page);
  await locator.click();
  await page.waitForTimeout(after);
}

async function humanType(page, locator, value, delay = 45) {
  await movePointerTo(page, locator, { xRatio: 0.28 });
  await pulsePointer(page);
  await locator.click();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Delete');
  await locator.pressSequentially(value, { delay });
  await page.waitForTimeout(650);
}

async function selectWithPointer(page, locator, option) {
  await movePointerTo(page, locator, { xRatio: 0.82 });
  await pulsePointer(page);
  await locator.selectOption(option);
  await page.waitForTimeout(750);
}

async function waitForPath(page, pathname) {
  await expect(page).toHaveURL((url) => (url.pathname.replace(/\/$/u, '') || '/') === pathname, {
    timeout: 20_000,
  });
}

async function clickSidebar(page, name, pathname) {
  const link = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name, exact: true });
  await clickWithPointer(page, link, 300);
  await waitForPath(page, pathname);
  await page.waitForTimeout(700);
  await installVideoOverlay(page);
}

async function clickActiveSidebar(page, name) {
  const link = page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name, exact: true });
  await movePointerTo(page, link);
  await pulsePointer(page);
  await link.evaluate((element) => {
    element.addEventListener('click', (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
    element.click();
  });
  await page.waitForTimeout(260);
}

async function authenticate(browser, email, password, adminEmail) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
  const page = await context.newPage();
  try {
    await page.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await page.getByLabel('Email address').fill(email);
    await page.locator('#password').fill(password);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/auth/login',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await loginResponse;
    if (!response.ok()) throw new Error(`Sign-in failed with HTTP ${String(response.status())}`);

    const tenantSwitcher = page.locator('#tenant-switcher');
    await expect(tenantSwitcher).toBeVisible({ timeout: 20_000 });
    const foundryOption = tenantSwitcher.locator('option').filter({ hasText: WORKSPACE_NAME });
    await expect(foundryOption).toHaveCount(1);
    const foundryTenantId = await foundryOption.getAttribute('value');
    if (!foundryTenantId) throw new Error('Foundry Demonstration has no workspace value');
    if ((await tenantSwitcher.inputValue()) !== foundryTenantId) {
      const tenantResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          new URL(candidate.url()).pathname === '/api/v1/auth/tenant-select',
      );
      await tenantSwitcher.selectOption(foundryTenantId);
      const selection = await tenantResponse;
      if (!selection.ok()) {
        throw new Error(`Workspace selection failed with HTTP ${String(selection.status())}`);
      }
    }
    await expect(tenantSwitcher).toHaveValue(foundryTenantId);
    if (email === adminEmail) {
      await expect(page.getByText('Administrator', { exact: true }).first()).toBeVisible();
    }
    return await context.storageState();
  } finally {
    await context.close();
  }
}

async function withPage(browser, storageState, action) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
    colorScheme: 'light',
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(30_000);
  try {
    return await action(page);
  } finally {
    await context.close();
  }
}

async function saveClip(browser, storageState, name, action) {
  const rawDirectory = join(RAW_ROOT, name);
  const outputPath = join(TAKE_ROOT, `${name}.webm`);
  await mkdir(rawDirectory, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    screen: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Dubai',
    colorScheme: 'light',
    storageState,
    recordVideo: { dir: rawDirectory, size: VIEWPORT },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  page.setDefaultNavigationTimeout(30_000);
  let video;
  try {
    await action(page);
    await page.waitForTimeout(900);
    video = page.video();
  } finally {
    await context.close();
  }
  if (!video) throw new Error(`No browser recording was created for ${name}`);
  await video.saveAs(outputPath);
  await rm(rawDirectory, { recursive: true, force: true });
  metadata.clips.push({ name, file: relative(PROJECT_ROOT, outputPath).replaceAll('\\', '/') });
  await persistMetadata();
}

async function createPendingRequest(browser, operatorState) {
  return withPage(browser, operatorState, async (page) => {
    await page.goto(`${WEB_ORIGIN}/requests`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('button', { name: 'Start request', exact: true }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Start request', exact: true }).first().click();
    const requestDialog = page.getByRole('dialog', { name: 'Start a request' });
    const requestType = requestDialog.getByLabel('What kind of request is this?');
    await expect(requestType).toBeEnabled();
    await requestType.selectOption({ label: WORKFLOW_NAME });
    await requestDialog.getByRole('button', { name: 'Continue to details', exact: true }).click();
    await requestDialog.getByLabel('Amount').fill('1250');
    await requestDialog.getByLabel('Cost center').fill('OPS-42');
    await requestDialog.getByLabel('Summary').fill(SUMMARY);
    await requestDialog.getByRole('button', { name: 'Review request', exact: true }).click();
    await expect(requestDialog.getByText('Ready to submit')).toBeVisible();
    const requestResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/requests',
    );
    await requestDialog.getByRole('button', { name: 'Submit request', exact: true }).click();
    const response = await requestResponse;
    if (!response.ok())
      throw new Error(`Request submission failed with HTTP ${String(response.status())}`);
    const request = await response.json();
    metadata.requestId = request.id;
    metadata.correlationId = request.correlationId;
    await persistMetadata();
    await expect(page.getByText('Waiting for approval', { exact: true }).first()).toBeVisible();
  });
}

async function recordOperatorSubmission(browser, operatorState) {
  await saveClip(browser, operatorState, 'v3-02-operator-submit', async (page) => {
    await page.goto(`${WEB_ORIGIN}/requests`, { waitUntil: 'domcontentloaded' });
    const startRequest = page.getByRole('button', { name: 'Start request', exact: true }).first();
    await expect(startRequest).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(
      page,
      'START A REQUEST',
      'Omar chooses the published request type and provides the business details',
      1700,
    );
    await clickWithPointer(page, startRequest, 450);
    const requestDialog = page.getByRole('dialog', { name: 'Start a request' });
    const requestType = requestDialog.getByLabel('What kind of request is this?');
    await expect(requestType).toBeEnabled();
    await selectWithPointer(page, requestType, { label: WORKFLOW_NAME });
    await clickWithPointer(
      page,
      requestDialog.getByRole('button', { name: 'Continue to details', exact: true }),
      350,
    );
    await humanType(page, requestDialog.getByLabel('Amount'), '1250', 80);
    await humanType(page, requestDialog.getByLabel('Cost center'), 'OPS-42', 70);
    await humanType(page, requestDialog.getByLabel('Summary'), SUMMARY, 42);
    await clickWithPointer(
      page,
      requestDialog.getByRole('button', { name: 'Review request', exact: true }),
      450,
    );
    await expect(requestDialog.getByText('Ready to submit')).toBeVisible();
    await showChapter(
      page,
      'REVIEW',
      'The requester checks the downstream path before sending the work',
      1700,
    );
    const requestResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/requests',
    );
    await clickWithPointer(
      page,
      requestDialog.getByRole('button', { name: 'Submit request', exact: true }),
      350,
    );
    const response = await requestResponse;
    if (!response.ok())
      throw new Error(`Request submission failed with HTTP ${String(response.status())}`);
    const request = await response.json();
    metadata.requestId = request.id;
    metadata.correlationId = request.correlationId;
    await persistMetadata();
    await expect(page.getByText('Waiting for approval', { exact: true }).first()).toBeVisible();
    await showChapter(
      page,
      'WAITING FOR A WITNESS',
      'QueueForge holds the request until a separate approver records a decision',
      1900,
    );
  });
}

async function waitForCompletion(browser, operatorState) {
  if (!metadata.requestId) throw new Error('The replacement request identity is unavailable');
  await withPage(browser, operatorState, async (page) => {
    await page.goto(`${WEB_ORIGIN}/requests/detail?id=${encodeURIComponent(metadata.requestId)}`, {
      waitUntil: 'domcontentloaded',
    });
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await expect(refresh).toBeVisible();
    await expect
      .poll(
        async () => {
          await refresh.click();
          await page.waitForTimeout(900);
          return (await page.getByText('Completed', { exact: true }).count()) > 0;
        },
        { timeout: 90_000, intervals: [900, 1200, 1600] },
      )
      .toBe(true);
  });
}

async function recordProcessingProof(browser, operatorState) {
  if (!metadata.requestId) throw new Error('The replacement request identity is unavailable');
  await saveClip(browser, operatorState, 'v3-04-request-processing', async (page) => {
    await page.goto(`${WEB_ORIGIN}/requests/detail?id=${encodeURIComponent(metadata.requestId)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
    const retrySummary = page.getByText('Finished after 2 tries', { exact: true }).first();
    await expect(retrySummary).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(
      page,
      'DURABLE PROCESSING',
      'The request succeeds on its second processing attempt without losing the first',
      2100,
    );
    await movePointerTo(page, retrySummary, { hold: 1100 });
    const historyTitle = page.getByText('Progress history', { exact: true });
    await historyTitle.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const retryMemory = page.getByText('QueueForge scheduled another try', { exact: true }).first();
    await expect(retryMemory).toBeVisible();
    await showChapter(
      page,
      'RETRY MEMORY',
      'The failed attempt remains in the chain before the successful retry',
      1900,
    );
    await movePointerTo(page, retryMemory, { hold: 1100 });
    await page.waitForTimeout(900);
  });
}

async function collectMatches(page, label, queries, rowLocator) {
  const results = [];
  const input = page.getByLabel(label);
  for (const query of queries) {
    await input.fill(query);
    await page.waitForTimeout(500);
    const rows = rowLocator();
    const count = await rows.count();
    const samples = [];
    for (let index = 0; index < Math.min(count, 2); index += 1) {
      samples.push(compactText(await rows.nth(index).innerText()));
    }
    results.push({ query, matchesOnCurrentPage: count, samples });
  }
  await input.fill('');
  return results;
}

async function truthCheckSearches(browser, states) {
  const approvals = await withPage(browser, states.approver, async (page) => {
    await page.goto(`${WEB_ORIGIN}/approvals`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Search approvals')).toBeVisible();
    return collectMatches(page, 'Search approvals', SEARCH_QUERIES.approvals, () =>
      page.locator('button[aria-controls="approval-review"]'),
    );
  });

  const deliveries = await withPage(browser, states.deliveryAdmin, async (page) => {
    await page.goto(`${WEB_ORIGIN}/webhooks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Delivery', exact: true })).toBeVisible();
    const activityTab = page.getByRole('tab', { name: /^Activity \(/u });
    await activityTab.click();
    await expect(page.getByLabel('Search delivery history')).toBeVisible();
    return collectMatches(page, 'Search delivery history', SEARCH_QUERIES.deliveries, () =>
      page
        .locator('#result-delivery-ledger [data-qf-delivery-row], #result-delivery-ledger > *')
        .filter({
          has: page.getByText(WORKFLOW_NAME, { exact: true }),
        }),
    );
  });

  const audit = await withPage(browser, states.auditAdmin, async (page) => {
    await page.goto(`${WEB_ORIGIN}/audit`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Show activity for')).toBeVisible();
    await page.getByLabel('Show activity for').selectOption({ label: 'Requests' });
    await expect(page.getByRole('list', { name: 'Workspace activity log' })).toBeVisible();
    return collectMatches(page, 'Search activity on this page', SEARCH_QUERIES.audit, () =>
      page.getByRole('list', { name: 'Workspace activity log' }).getByRole('listitem'),
    );
  });

  const report = {
    generatedAt: new Date().toISOString(),
    scope: 'Live current-page filters in Foundry Demonstration',
    approvals,
    deliveries,
    audit,
    limitations: [
      'Approval search covers the loaded page only: request type, requester, status, and submitted payload.',
      'Delivery search covers the loaded page only: receiver, event/action, event identity, request type, request identity, and delivery status. It does not index the request payload or requester.',
      'Activity search covers the loaded page only after the server-side category filter. It indexes the plain-language action, category, actor, technical event data, and correlation reference; it does not reliably index request-type or submitted form text.',
    ],
  };
  await writeFile(TRUTH_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function recordApproverDecision(browser, approverState) {
  await saveClip(browser, approverState, 'v3-03-approver-decide', async (page) => {
    await page.goto(`${WEB_ORIGIN}/approvals`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Search approvals')).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(page, 'DECIDE', 'A separate approver finds the request by its human summary');
    await humanType(page, page.getByLabel('Search approvals'), APPROVAL_SEARCH, 52);
    const requestCard = page
      .locator('button[aria-controls="approval-review"]')
      .filter({ hasText: APPROVAL_SEARCH })
      .first();
    await expect(requestCard).toBeVisible({ timeout: 30_000 });
    await expect(requestCard).toContainText('Dubai client workshop');
    await clickWithPointer(page, requestCard, 850);
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    await clickWithPointer(page, approve, 500);
    const note = page.getByLabel('Note for the requester');
    await humanType(page, note, 'Approved for the client workshop.', 48);
    const decisionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/decide'),
    );
    await clickWithPointer(page, page.getByRole('button', { name: 'Approve request' }), 300);
    const response = await decisionResponse;
    if (!response.ok()) throw new Error(`Approval failed with HTTP ${String(response.status())}`);
    await expect(
      page.getByText('Request approved. QueueForge will start the next step.'),
    ).toBeVisible();
    await showChapter(page, 'SIGNED', 'The decision is recorded and processing can begin', 1800);
  });
}

async function recordDelivery(browser, adminState) {
  await saveClip(browser, adminState, 'v3-05-delivery-receipt', async (page) => {
    await page.goto(`${WEB_ORIGIN}/webhooks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Delivery', exact: true })).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(page, 'DELIVER', 'Find the signed result by its request type');
    await clickWithPointer(page, page.getByRole('tab', { name: /^Activity \(/u }), 700);
    await humanType(page, page.getByLabel('Search delivery history'), WORKFLOW_NAME, 52);
    const ledger = page.locator('#result-delivery-ledger');
    await expect(ledger).toContainText(WORKFLOW_NAME, { timeout: 60_000 });
    await expect(ledger).toContainText('Delivered');
    const deliveryRow = ledger.getByRole('row').filter({ hasText: 'Request completed' }).first();
    const details = deliveryRow.getByText('Details', { exact: true });
    await clickWithPointer(page, details, 900);
    if (metadata.requestId) {
      await expect(deliveryRow).toContainText(metadata.requestId.slice(0, 8));
    }
    await showChapter(
      page,
      'RECEIPT',
      'The connected receiver accepted the completed result',
      1800,
    );
  });
}

async function recordAudit(browser, adminState) {
  await saveClip(browser, adminState, 'v3-06-admin-audit', async (page) => {
    await page.goto(`${WEB_ORIGIN}/audit`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Show activity for')).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(page, 'TRACE', 'Use the action name to find the retained completion record');
    await selectWithPointer(page, page.getByLabel('Show activity for'), { label: 'Requests' });
    await humanType(page, page.getByLabel('Search activity on this page'), 'Request completed', 52);
    const ledger = page.getByRole('list', { name: 'Workspace activity log' });
    await expect(ledger).toContainText('Request completed', { timeout: 40_000 });
    const details = ledger
      .getByRole('button', { name: 'View details for Request completed' })
      .first();
    await clickWithPointer(page, details, 900);
    const dialog = page.getByRole('dialog', { name: 'Request completed' });
    await expect(dialog.getByText(/Technical record/i).first()).toBeVisible();
    if (metadata.correlationId) {
      await expect(dialog).toContainText(metadata.correlationId.slice(0, 8));
    }
    await showChapter(
      page,
      'AUDIT PROOF',
      'Actor, action, target, time, and technical evidence stay connected',
      1900,
    );
  });
}

async function recordOperatorNotification(browser, operatorState) {
  await saveClip(browser, operatorState, 'v3-06-operator-result', async (page) => {
    await page.goto(`${WEB_ORIGIN}/notifications`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(page, 'RESULT', 'The requester receives a plain-language completion update');
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    if (await refresh.isVisible()) await clickWithPointer(page, refresh, 700);
    const completion = page.getByText('Expense review completed', { exact: true }).first();
    await expect(completion).toBeVisible({ timeout: 30_000 });
    await movePointerTo(page, completion, { hold: 850 });
    await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
    await showChapter(
      page,
      'COMPLETE',
      'The outcome and its delivery status are ready to inspect',
      1700,
    );
  });
}

async function recordAuthenticatedTour(browser, adminState) {
  await saveClip(browser, adminState, '11-authenticated-product-tour', async (page) => {
    await page.goto(`${WEB_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /Admin overview/u })).toBeVisible();
    await installVideoOverlay(page);
    await showChapter(
      page,
      'HOME',
      'See priorities, live health, and the four-stage proof instrument',
      1750,
    );
    await movePointerTo(page, page.getByText('Priority now', { exact: true }).first(), {
      hold: 1000,
    });

    await clickSidebar(page, 'Request types', '/workflows');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Request types', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'REQUEST TYPES',
      'Define the form, decision rule, processing policy, and delivery path',
      1750,
    );
    await movePointerTo(page, page.getByText(WORKFLOW_NAME, { exact: true }).first(), {
      hold: 1000,
    });

    await clickSidebar(page, 'Delivery connections', '/webhooks');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Delivery', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'DELIVERY CONNECTIONS',
      'Manage the systems allowed to receive signed results',
      1750,
    );
    const connectionDetails = page.getByText('Details', { exact: true }).first();
    if (await connectionDetails.isVisible())
      await movePointerTo(page, connectionDetails, { hold: 1000 });

    await clickSidebar(page, 'People & access', '/team');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Team & access', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'PEOPLE & ACCESS',
      'Review each member, role, status, and protected access rule',
      1750,
    );
    await humanType(page, page.getByLabel('Search members'), 'Omar', 58);
    await expect(page.getByText('Omar Operator', { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(900);

    await clickSidebar(page, 'Processing health', '/operations');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Processing', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'PROCESSING HEALTH',
      'Inspect queue lanes, retries, worker heartbeat, and recovery state',
      1750,
    );
    await movePointerTo(page, page.getByText('Processing lanes', { exact: true }).first(), {
      hold: 1000,
    });

    await clickSidebar(page, 'Activity log', '/audit');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Activity log', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'ACTIVITY LOG',
      'Filter the durable history by the action a human understands',
      1750,
    );
    await selectWithPointer(page, page.getByLabel('Show activity for'), { label: 'Requests' });
    await movePointerTo(page, page.getByText('Request completed', { exact: true }).first(), {
      hold: 1000,
    });

    await clickSidebar(page, 'Notifications', '/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notifications', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'NOTIFICATIONS',
      'Open the updates that need attention or lead back to a request',
      1750,
    );
    const firstOpenRequest = page.getByRole('link', { name: 'Open request', exact: true }).first();
    if (await firstOpenRequest.isVisible())
      await movePointerTo(page, firstOpenRequest, { hold: 1200 });
  });
}

async function recordHomeTourEntry(browser, adminState) {
  await saveClip(browser, adminState, '12-tour-home-click', async (page) => {
    await page.goto(`${WEB_ORIGIN}/workflows`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Request types', exact: true }),
    ).toBeVisible();
    await installVideoOverlay(page);
    await page.waitForTimeout(650);
    await clickSidebar(page, 'Home', '/');
    await expect(page.getByRole('heading', { level: 1, name: /Admin overview/u })).toBeVisible();
    await showChapter(
      page,
      'HOME',
      'See priority work, live health, and the four-stage proof instrument',
      1750,
    );
    await movePointerTo(page, page.getByText('Priority now', { exact: true }).first(), {
      hold: 1200,
    });
    await page.waitForTimeout(2500);
  });
}

async function recordNotificationTourEntry(browser, operatorState) {
  await saveClip(browser, operatorState, '13-tour-notifications-click', async (page) => {
    await page.goto(`${WEB_ORIGIN}/requests`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('button', { name: 'Start request', exact: true }).first(),
    ).toBeVisible();
    await installVideoOverlay(page);
    await page.waitForTimeout(650);
    await clickSidebar(page, 'Notifications', '/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notifications', exact: true }),
    ).toBeVisible();
    const completion = page.getByText('Expense review completed', { exact: true }).first();
    await expect(completion).toBeVisible({ timeout: 30_000 });
    await showChapter(
      page,
      'NOTIFICATIONS',
      'The requester receives the completed result in plain language',
      1750,
    );
    await movePointerTo(page, completion, { hold: 1000 });
    const openRequest = page.getByRole('link', { name: 'Open request', exact: true }).first();
    if (await openRequest.isVisible()) await movePointerTo(page, openRequest, { hold: 1200 });
    await page.waitForTimeout(1800);
  });
}

async function recordStableTourClip(
  browser,
  storageState,
  { name, path, navLabel, heading, chapter, message, prepare, focus },
) {
  await saveClip(browser, storageState, name, async (page) => {
    await page.goto(`${WEB_ORIGIN}${path}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible({
      timeout: 20_000,
    });
    if (prepare) await prepare(page);
    await page.waitForTimeout(1100);
    await installVideoOverlay(page);
    await page.waitForTimeout(500);
    await clickActiveSidebar(page, navLabel);
    await showChapter(page, chapter, message, 1550);
    if (focus) await focus(page);
    await page.waitForTimeout(2500);
  });
}

async function recordTourContract(browser, password, adminEmail) {
  const adminClips = [
    {
      name: 'v3-07-tour-home',
      path: '/',
      navLabel: 'Home',
      heading: 'Admin overview',
      chapter: 'HOME',
      message: 'See priority work, live health, and the four-stage proof instrument',
      focus: (page) =>
        movePointerTo(page, page.getByText('Priority now', { exact: true }).first(), {
          hold: 900,
        }),
    },
    {
      name: 'v3-08-tour-request-types',
      path: '/workflows',
      navLabel: 'Request types',
      heading: 'Request types',
      chapter: 'REQUEST TYPES',
      message: 'Define the form, decision rule, processing policy, and delivery path',
      focus: (page) =>
        movePointerTo(page, page.getByText(WORKFLOW_NAME, { exact: true }).first(), {
          hold: 900,
        }),
    },
    {
      name: 'v3-09-tour-delivery-connections',
      path: '/webhooks',
      navLabel: 'Delivery connections',
      heading: 'Delivery',
      chapter: 'DELIVERY CONNECTIONS',
      message: 'Choose the trusted receiver for each signed result',
      focus: (page) =>
        movePointerTo(page, page.getByText('Dubai operations receiver', { exact: true }).first(), {
          hold: 900,
        }),
    },
    {
      name: 'v3-10-tour-people-access',
      path: '/team',
      navLabel: 'People & access',
      heading: 'Team & access',
      chapter: 'PEOPLE & ACCESS',
      message: 'Review each member, role, status, and protected access rule',
      focus: (page) =>
        movePointerTo(page, page.getByText('Omar Operator', { exact: true }).first(), {
          hold: 900,
        }),
    },
    {
      name: 'v3-11-tour-processing-health',
      path: '/operations',
      navLabel: 'Processing health',
      heading: 'Processing',
      chapter: 'PROCESSING HEALTH',
      message: 'Inspect queue lanes, retry memory, worker heartbeat, and recovery state',
      focus: (page) =>
        movePointerTo(page, page.getByText('Processing lanes', { exact: true }).first(), {
          hold: 900,
        }),
    },
    {
      name: 'v3-12-tour-activity-log',
      path: '/audit',
      navLabel: 'Activity log',
      heading: 'Activity log',
      chapter: 'ACTIVITY LOG',
      message: 'Filter durable history by a plain-language action',
      prepare: async (page) => {
        await page.getByLabel('Show activity for').selectOption({ label: 'Requests' });
        await expect(page.getByText('Request completed', { exact: true }).first()).toBeVisible();
      },
      focus: (page) =>
        movePointerTo(page, page.getByText('Request completed', { exact: true }).first(), {
          hold: 900,
        }),
    },
  ];
  for (const clip of adminClips) {
    await recordStableTourClip(
      browser,
      await authenticate(browser, adminEmail, password, adminEmail),
      clip,
    );
  }
  await recordStableTourClip(
    browser,
    await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
    {
      name: 'v3-13-tour-notifications',
      path: '/notifications',
      navLabel: 'Notifications',
      heading: 'Notifications',
      chapter: 'NOTIFICATIONS',
      message: 'Open the completed result or return to its request',
      prepare: async (page) => {
        await expect(
          page.getByText('Expense review completed', { exact: true }).first(),
        ).toBeVisible();
      },
      focus: (page) =>
        movePointerTo(page, page.getByRole('link', { name: 'Open request', exact: true }).first(), {
          hold: 900,
        }),
    },
  );
}

async function recordLoggedOutOrientation(browser, password) {
  await saveClip(browser, undefined, '14-login-role-orientation', async (page) => {
    await page.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
    const email = page.getByLabel('Email address');
    const passwordInput = page.locator('#password');
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await expect(email).toHaveValue('');
    await expect(passwordInput).toHaveValue('');
    await installVideoOverlay(page);
    await page.waitForTimeout(1800);
    await showChapter(
      page,
      'ROLE-FOCUSED ACCESS',
      'Omar signs in to the workspace and tools assigned to an operator',
      1500,
    );
    await clickWithPointer(page, email, 180);
    await email.fill(OPERATOR_EMAIL);
    await page.waitForTimeout(450);
    await clickWithPointer(page, passwordInput, 180);
    await passwordInput.fill(password);
    await page.waitForTimeout(550);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/v1/auth/login',
    );
    await clickWithPointer(page, page.getByRole('button', { name: 'Sign in', exact: true }), 250);
    const response = await loginResponse;
    if (!response.ok())
      throw new Error(`Operator sign-in failed with HTTP ${String(response.status())}`);

    const tenantSwitcher = page.locator('#tenant-switcher');
    await expect(tenantSwitcher).toBeVisible({ timeout: 20_000 });
    await installVideoOverlay(page);
    const foundryOption = tenantSwitcher.locator('option').filter({ hasText: WORKSPACE_NAME });
    await expect(foundryOption).toHaveCount(1);
    const foundryTenantId = await foundryOption.getAttribute('value');
    if (!foundryTenantId) throw new Error('Foundry Demonstration has no workspace value');
    if ((await tenantSwitcher.inputValue()) !== foundryTenantId) {
      const tenantResponse = page.waitForResponse(
        (candidate) =>
          candidate.request().method() === 'POST' &&
          new URL(candidate.url()).pathname === '/api/v1/auth/tenant-select',
      );
      await selectWithPointer(page, tenantSwitcher, foundryTenantId);
      const selection = await tenantResponse;
      if (!selection.ok()) {
        throw new Error(`Workspace selection failed with HTTP ${String(selection.status())}`);
      }
    }
    await expect(
      page.getByRole('heading', { level: 1, name: 'Operations overview', exact: true }),
    ).toBeVisible();
    await showChapter(
      page,
      'OPERATIONS WORKSPACE',
      'Omar can start requests, follow progress, and inspect every handoff',
      1900,
    );
    const startRequest = page.getByRole('link', { name: /Start a request/u }).first();
    if (await startRequest.isVisible()) await movePointerTo(page, startRequest, { hold: 1100 });
    await page.waitForTimeout(4200);
  });
}

async function run() {
  assertLoopbackOrigin(WEB_ORIGIN);
  const env = parseEnv(await readFile(join(PROJECT_ROOT, '.env'), 'utf8'));
  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ?? env.get('BOOTSTRAP_ADMIN_PASSWORD') ?? '';
  const adminEmail =
    process.env.BOOTSTRAP_ADMIN_EMAIL ??
    env.get('BOOTSTRAP_ADMIN_EMAIL') ??
    'admin@queueforge.test';
  if (password.length === 0) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is unavailable');

  if (RESUME) {
    const savedMetadata = JSON.parse(await readFile(METADATA_PATH, 'utf8'));
    Object.assign(metadata, savedMetadata, { status: 'resuming' });
    delete metadata.error;
    if (!metadata.requestId || !metadata.correlationId) {
      throw new Error('The selected take has no pending request identity to resume');
    }
  }

  await mkdir(TAKE_ROOT, { recursive: true });
  await mkdir(RAW_ROOT, { recursive: true });
  metadata.status = 'recording';
  await persistMetadata();

  const browser = await chromium.launch({
    channel: process.env.PW_BROWSER_CHANNEL ?? 'chrome',
    headless: true,
    args: ['--disable-notifications'],
  });
  try {
    if (ROLE_ONLY) {
      await recordLoggedOutOrientation(browser, password);
      metadata.status = 'complete';
      await persistMetadata();
      process.stdout.write(
        `${JSON.stringify(
          {
            take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
            clips: metadata.clips,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (TOUR_CONTRACT_ONLY) {
      await recordTourContract(browser, password, adminEmail);
      metadata.status = 'complete';
      await persistMetadata();
      process.stdout.write(
        `${JSON.stringify(
          {
            take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
            clips: metadata.clips,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    if (SUPPLEMENTS_ONLY) {
      await recordHomeTourEntry(
        browser,
        await authenticate(browser, adminEmail, password, adminEmail),
      );
      await recordNotificationTourEntry(
        browser,
        await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
      );
      await recordLoggedOutOrientation(browser, password);
      metadata.status = 'complete';
      await persistMetadata();
      process.stdout.write(
        `${JSON.stringify(
          {
            take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
            clips: metadata.clips,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const initialStates = {
      operator: await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
    };

    if (!RESUME) await recordOperatorSubmission(browser, initialStates.operator);
    if (!hasRecordedClip('v3-03-approver-decide')) {
      await recordApproverDecision(
        browser,
        await authenticate(browser, APPROVER_EMAIL, password, adminEmail),
      );
    }
    await waitForCompletion(
      browser,
      await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
    );
    if (!hasRecordedClip('v3-04-request-processing')) {
      await recordProcessingProof(
        browser,
        await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
      );
    }
    if (!hasRecordedClip('v3-05-delivery-receipt')) {
      await recordDelivery(browser, await authenticate(browser, adminEmail, password, adminEmail));
    }
    if (!hasRecordedClip('v3-06-admin-audit')) {
      await recordAudit(browser, await authenticate(browser, adminEmail, password, adminEmail));
    }
    if (!hasRecordedClip('v3-06-operator-result')) {
      await recordOperatorNotification(
        browser,
        await authenticate(browser, OPERATOR_EMAIL, password, adminEmail),
      );
    }
    if (!WORKFLOW_CONTRACT_ONLY && !hasRecordedClip('11-authenticated-product-tour')) {
      await recordAuthenticatedTour(
        browser,
        await authenticate(browser, adminEmail, password, adminEmail),
      );
    }
    if (WORKFLOW_CONTRACT_ONLY) {
      metadata.status = 'complete';
      await persistMetadata();
      process.stdout.write(
        `${JSON.stringify(
          {
            take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
            clips: metadata.clips,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    const report = await truthCheckSearches(browser, {
      approver: await authenticate(browser, APPROVER_EMAIL, password, adminEmail),
      deliveryAdmin: await authenticate(browser, adminEmail, password, adminEmail),
      auditAdmin: await authenticate(browser, adminEmail, password, adminEmail),
    });
    metadata.status = 'complete';
    await persistMetadata();
    process.stdout.write(
      `${JSON.stringify(
        {
          take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
          searchReport: relative(PROJECT_ROOT, TRUTH_REPORT_PATH).replaceAll('\\', '/'),
          queryMatchCounts: Object.fromEntries(
            Object.entries(report).flatMap(([area, results]) =>
              Array.isArray(results)
                ? [
                    [
                      area,
                      results.map(({ query, matchesOnCurrentPage }) => ({
                        query,
                        matchesOnCurrentPage,
                      })),
                    ],
                  ]
                : [],
            ),
          ),
          clips: metadata.clips,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    metadata.status = 'failed';
    metadata.error = safeError(error, password);
    await persistMetadata();
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

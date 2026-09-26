import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { chromium, expect } from '@playwright/test';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const RECORDING_ROOT = resolve(import.meta.dirname);
const TAKES_ROOT = join(RECORDING_ROOT, 'takes');
const VIEWPORT = { width: 1440, height: 900 };

const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/u, '');
const SINK_ORIGIN = (process.env.SINK_ORIGIN ?? 'http://127.0.0.1:3300').replace(/\/$/u, '');

const WORKSPACE_NAME = 'Foundry Demonstration';
const WORKFLOW_NAME = 'Expense review';
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? 'operator@queueforge.local';
const APPROVER_EMAIL = process.env.E2E_APPROVER_EMAIL ?? 'approver@queueforge.local';

const TAKE_ID =
  process.argv.find((argument) => argument.startsWith('--take='))?.slice('--take='.length) ??
  new Date().toISOString().replace(/[:.]/gu, '-');
const HEADED = process.argv.includes('--headed');
const RESUME_NOTIFICATION = process.argv.includes('--resume-notification');
const TAKE_ROOT = resolve(TAKES_ROOT, TAKE_ID);
const RAW_ROOT = join(TAKE_ROOT, '.raw');
const METADATA_PATH = join(TAKE_ROOT, 'metadata.private.json');

const summaryMarker = `Dubai client workshop travel — Film ${TAKE_ID.replace(/[^a-z0-9]/giu, '').slice(-14)}`;

/** @type {{
 * stage: string;
 * takeId: string;
 * createdAt: string;
 * origin: string;
 * workspace: string;
 * workflow: string;
 * summary: string;
 * amount: string;
 * costCenter: string;
 * requestId: string | null;
 * correlationId: string | null;
 * clips: Array<{name: string; file: string}>;
 * accounts: {operator: string; approver: string; admin: string};
 * passwordSource: string;
 * status: string;
 * error?: string;
 * }} */
const metadata = {
  stage: 'initializing',
  takeId: TAKE_ID,
  createdAt: new Date().toISOString(),
  origin: WEB_ORIGIN,
  workspace: WORKSPACE_NAME,
  workflow: WORKFLOW_NAME,
  summary: summaryMarker,
  amount: '1250',
  costCenter: 'OPS-42',
  requestId: null,
  correlationId: null,
  clips: [],
  accounts: {
    operator: OPERATOR_EMAIL,
    approver: APPROVER_EMAIL,
    admin: '',
  },
  passwordSource: 'BOOTSTRAP_ADMIN_PASSWORD from local .env',
  status: 'recording',
};

function assertLoopbackOrigin(value, label) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`${label} must remain loopback-only for this recording`);
  }
}

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

async function persistMetadata() {
  await mkdir(TAKE_ROOT, { recursive: true });
  await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

async function verifyEndpoint(url, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
}

async function installVideoOverlay(page) {
  await page.evaluate(() => {
    if (document.querySelector('[data-qf-video-pointer]')) return;

    const style = document.createElement('style');
    style.dataset.qfVideoOverlay = 'true';
    style.textContent = `
      [data-qf-video-pointer] {
        position: fixed;
        left: 42px;
        top: 42px;
        width: 25px;
        height: 31px;
        z-index: 2147483647;
        pointer-events: none;
        filter: drop-shadow(0 3px 5px rgb(0 0 0 / .34));
        transform: translate(-4px, -3px);
        transition: left 320ms cubic-bezier(.22,.8,.24,1), top 320ms cubic-bezier(.22,.8,.24,1);
      }
      [data-qf-video-pointer] svg { display: block; width: 100%; height: 100%; }
      [data-qf-video-pointer]::after {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        width: 26px;
        height: 26px;
        border: 2px solid #e4a84b;
        border-radius: 999px;
        opacity: 0;
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
        position: fixed;
        left: 50%;
        bottom: 30px;
        z-index: 2147483646;
        pointer-events: none;
        max-width: min(620px, calc(100vw - 48px));
        padding: 10px 16px 11px;
        border: 1px solid rgb(228 168 75 / .58);
        border-radius: 9px;
        background: rgb(5 13 17 / .94);
        box-shadow: 0 12px 34px rgb(0 0 0 / .28), inset 0 1px rgb(255 255 255 / .08);
        color: #f5f1e8;
        font: 650 14px/1.25 system-ui, sans-serif;
        letter-spacing: .01em;
        opacity: 0;
        transform: translate(-50%, 8px);
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

async function showChapter(page, step, message, hold = 1300) {
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
  await page.waitForTimeout(260);
}

async function movePointerTo(page, locator, options = {}) {
  const { xRatio = 0.5, yRatio = 0.5, hold = 380 } = options;
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 20_000 });
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Could not resolve the visible target geometry');
  await installVideoOverlay(page);
  await page.evaluate(
    ({ x, y }) => {
      const pointer = document.querySelector('[data-qf-video-pointer]');
      if (pointer instanceof HTMLElement) {
        pointer.style.left = `${x}px`;
        pointer.style.top = `${y}px`;
      }
    },
    { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio },
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
  await page.waitForTimeout(130);
}

async function clickWithPointer(page, locator, options = {}) {
  const { after = 650, ...pointerOptions } = options;
  await movePointerTo(page, locator, pointerOptions);
  await pulsePointer(page);
  await locator.click();
  await page.waitForTimeout(after);
}

async function humanType(page, locator, value, options = {}) {
  const { delay = 50, after = 500, secret = false } = options;
  await movePointerTo(page, locator, { xRatio: 0.28 });
  await pulsePointer(page);
  await locator.click();
  await locator.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await locator.press('Delete');
  if (secret) {
    await locator.fill(value);
    await page.waitForTimeout(450);
  } else {
    await locator.pressSequentially(value, { delay });
  }
  await page.waitForTimeout(after);
}

async function selectWithPointer(page, locator, option) {
  await movePointerTo(page, locator, { xRatio: 0.82 });
  await pulsePointer(page);
  await locator.selectOption(option);
  await page.waitForTimeout(650);
}

async function smoothScrollTo(page, locator, offset = 90) {
  await expect(locator).toBeAttached({ timeout: 20_000 });
  await locator.evaluate((element, topOffset) => {
    const top = element.getBoundingClientRect().top + window.scrollY - Number(topOffset);
    window.scrollTo({ top, behavior: 'smooth' });
  }, offset);
  await page.waitForTimeout(1100);
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
  await clickWithPointer(page, link, { after: 250 });
  await waitForPath(page, pathname);
  await page.waitForTimeout(550);
}

async function loginAndSelectWorkspace(page, email, password, roleLabel) {
  await page.goto(`${WEB_ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled({
    timeout: 20_000,
  });
  await installVideoOverlay(page);
  await showChapter(page, roleLabel, 'Sign in to the local demonstration workspace');
  await humanType(page, page.getByLabel('Email address'), email, { delay: 42 });
  await humanType(page, page.locator('#password'), password, { secret: true });
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/login',
  );
  await clickWithPointer(page, submit, { after: 150 });
  const response = await loginResponse;
  if (!response.ok()) throw new Error(`Local sign-in returned HTTP ${response.status()}`);
  const tenantSwitcher = page.locator('#tenant-switcher');
  await expect(tenantSwitcher).toBeVisible({ timeout: 20_000 });
  await installVideoOverlay(page);

  const foundryOption = tenantSwitcher.locator('option').filter({ hasText: WORKSPACE_NAME });
  await expect(foundryOption).toHaveCount(1);
  const foundryTenantId = await foundryOption.getAttribute('value');
  if (!foundryTenantId) throw new Error('Foundry Demonstration workspace option has no value');

  if ((await tenantSwitcher.inputValue()) !== foundryTenantId) {
    const tenantResponse = page.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'POST' &&
        new URL(candidate.url()).pathname === '/api/v1/auth/tenant-select',
    );
    await selectWithPointer(page, tenantSwitcher, foundryTenantId);
    const selection = await tenantResponse;
    if (!selection.ok()) throw new Error(`Workspace selection returned HTTP ${selection.status()}`);
  }
  await expect(tenantSwitcher).toHaveValue(foundryTenantId);
  await page.waitForTimeout(700);
}

async function saveClip({ browser, name, storageState, action }) {
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
    reducedMotion: 'no-preference',
    recordVideo: { dir: rawDirectory, size: VIEWPORT },
    ...(storageState ? { storageState } : {}),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(25_000);
  let nextState;
  let video;
  try {
    await action(page);
    await page.waitForTimeout(700);
    nextState = await context.storageState();
    video = page.video();
  } finally {
    await context.close();
  }
  if (video === null || video === undefined) throw new Error(`No video was created for ${name}`);
  await video.saveAs(outputPath);
  await rm(rawDirectory, { recursive: true, force: true });
  metadata.clips.push({ name, file: relative(PROJECT_ROOT, outputPath).replaceAll('\\', '/') });
  metadata.stage = name;
  await persistMetadata();
  return nextState;
}

async function run() {
  assertLoopbackOrigin(WEB_ORIGIN, 'WEB_ORIGIN');
  assertLoopbackOrigin(API_ORIGIN, 'API origin');
  assertLoopbackOrigin(SINK_ORIGIN, 'Sink origin');

  const env = parseEnv(await readFile(join(PROJECT_ROOT, '.env'), 'utf8'));
  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ?? env.get('BOOTSTRAP_ADMIN_PASSWORD') ?? '';
  const adminEmail =
    process.env.BOOTSTRAP_ADMIN_EMAIL ??
    env.get('BOOTSTRAP_ADMIN_EMAIL') ??
    'admin@queueforge.test';
  if (password.length === 0)
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is unavailable in the local environment');
  metadata.accounts.admin = adminEmail;

  if (RESUME_NOTIFICATION) {
    const savedMetadata = JSON.parse(await readFile(METADATA_PATH, 'utf8'));
    Object.assign(metadata, savedMetadata, {
      stage: 'resuming-notification',
      status: 'recording',
    });
    delete metadata.error;
    if (!metadata.requestId || !metadata.correlationId) {
      throw new Error('The selected take does not contain a completed request identity');
    }
  }

  await mkdir(TAKE_ROOT, { recursive: true });
  await mkdir(RAW_ROOT, { recursive: true });
  await persistMetadata();
  await Promise.all([
    verifyEndpoint(`${WEB_ORIGIN}/login`, 'QueueForge web'),
    verifyEndpoint(`${API_ORIGIN}/api/v1/health/ready`, 'QueueForge API readiness'),
    verifyEndpoint(`${SINK_ORIGIN}/health`, 'QueueForge demo receiver'),
  ]);

  let browser;
  try {
    browser = await chromium.launch({
      channel: process.env.PW_BROWSER_CHANNEL ?? 'chrome',
      headless: !HEADED,
      args: ['--disable-notifications'],
    });

    if (RESUME_NOTIFICATION) {
      await saveClip({
        browser,
        name: '06-operator-notification',
        action: async (page) => {
          await loginAndSelectWorkspace(page, OPERATOR_EMAIL, password, 'OPERATOR');
          await clickSidebar(page, 'Notifications', '/notifications');
          await showChapter(page, 'COMPLETE', 'The requester receives the delivered outcome');
          const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
          if (await refresh.isVisible()) await clickWithPointer(page, refresh, { after: 600 });
          const completion = page.getByText('Expense review completed', { exact: true }).first();
          await expect(completion).toBeVisible({ timeout: 30_000 });
          await smoothScrollTo(page, completion, 250);
          await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
          const openRequest = page.getByRole('link', { name: 'Open request', exact: true }).first();
          await movePointerTo(page, openRequest);
          await page.waitForTimeout(1700);
        },
      });
      metadata.stage = 'complete';
      metadata.status = 'complete';
      await persistMetadata();
      return;
    }

    let operatorState = await saveClip({
      browser,
      name: '01-operator-intake',
      action: async (page) => {
        await loginAndSelectWorkspace(page, OPERATOR_EMAIL, password, 'OPERATOR');
        await clickSidebar(page, 'Start & track requests', '/requests');
        await showChapter(page, 'STEP 1', 'Create a request with a clear chain of custody');
        await clickWithPointer(
          page,
          page.getByRole('button', { name: 'Start request', exact: true }).first(),
        );

        const requestDialog = page.getByRole('dialog', { name: 'Start a request' });
        const requestType = requestDialog.getByLabel('What kind of request is this?');
        await expect(requestType).toBeEnabled();
        await selectWithPointer(page, requestType, { label: WORKFLOW_NAME });
        await clickWithPointer(
          page,
          requestDialog.getByRole('button', { name: 'Continue to details', exact: true }),
        );
        await humanType(page, requestDialog.getByLabel('Amount'), metadata.amount, { delay: 90 });
        await humanType(page, requestDialog.getByLabel('Cost center'), metadata.costCenter, {
          delay: 80,
        });
        await humanType(page, requestDialog.getByLabel('Summary'), metadata.summary, { delay: 42 });
        await clickWithPointer(
          page,
          requestDialog.getByRole('button', { name: 'Review request', exact: true }),
          { after: 850 },
        );
        await expect(requestDialog.getByText('Ready to submit')).toBeVisible();
        await smoothScrollTo(page, requestDialog.getByText('Your answers'), 160);
        await page.waitForTimeout(1000);

        const requestResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname === '/api/v1/requests',
        );
        await clickWithPointer(
          page,
          requestDialog.getByRole('button', { name: 'Submit request', exact: true }),
          { after: 250 },
        );
        const response = await requestResponsePromise;
        if (!response.ok())
          throw new Error(`Request submission returned HTTP ${response.status()}`);
        const request = await response.json();
        metadata.requestId = request.id;
        metadata.correlationId = request.correlationId;
        await persistMetadata();
        await expect(page).toHaveURL(new RegExp(`/requests/detail/?\\?id=${request.id}$`, 'u'));
        await expect(page.getByText('Waiting for approval', { exact: true }).first()).toBeVisible();
        await installVideoOverlay(page);
        await showChapter(
          page,
          'PROOF 01',
          'The request is locked and waiting for an independent decision',
          1700,
        );
        await page.waitForTimeout(900);
      },
    });

    let approverState = await saveClip({
      browser,
      name: '02-approver-decision',
      action: async (page) => {
        await loginAndSelectWorkspace(page, APPROVER_EMAIL, password, 'APPROVER');
        await clickSidebar(page, 'Approval inbox', '/approvals');
        await showChapter(page, 'STEP 2', 'A separate approver reviews the exact request');
        const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
        if (await refresh.isVisible()) await clickWithPointer(page, refresh, { after: 450 });
        await humanType(page, page.getByLabel('Search approvals'), metadata.summary, { delay: 32 });
        const requestCard = page.getByRole('button').filter({ hasText: metadata.summary }).first();
        if (await requestCard.isVisible())
          await clickWithPointer(page, requestCard, { after: 700 });
        const approve = page.getByRole('button', { name: 'Approve', exact: true });
        await expect(approve).toBeVisible({ timeout: 30_000 });
        await clickWithPointer(page, approve);
        const note = page.getByLabel('Note for the requester');
        await humanType(page, note, 'Approved for the client workshop.', { delay: 45 });
        const decisionResponse = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname.endsWith('/decide'),
        );
        await clickWithPointer(page, page.getByRole('button', { name: 'Approve request' }), {
          after: 250,
        });
        const response = await decisionResponse;
        if (!response.ok()) throw new Error(`Approval returned HTTP ${response.status()}`);
        await expect(
          page.getByText('Request approved. QueueForge will start the next step.'),
        ).toBeVisible();
        await showChapter(
          page,
          'PROOF 02',
          'The witness decision is signed and processing can begin',
          1700,
        );
        await page.waitForTimeout(900);
      },
    });

    operatorState = await saveClip({
      browser,
      name: '03-operator-proof',
      storageState: operatorState,
      action: async (page) => {
        if (!metadata.requestId) throw new Error('Request ID was not captured after submission');
        await page.goto(`${WEB_ORIGIN}/requests/detail?id=${metadata.requestId}`, {
          waitUntil: 'domcontentloaded',
        });
        await installVideoOverlay(page);
        await showChapter(page, 'STEP 3', 'QueueForge retries safely and preserves every attempt');
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
        await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/Proof sealed|outcome preserved/i).first()).toBeVisible();
        const progress = page.getByText('Progress history', { exact: true }).first();
        await smoothScrollTo(page, progress, 110);
        await expect(page.getByText(/Trying again|after 2 tries/i).first()).toBeVisible();
        await showChapter(
          page,
          'PROOF 03',
          'The successful result survives without erasing retry history',
          1900,
        );
        await page.waitForTimeout(1200);
      },
    });

    let adminState = await saveClip({
      browser,
      name: '04-admin-delivery',
      action: async (page) => {
        if (!metadata.requestId) throw new Error('Request ID was not captured after submission');
        await loginAndSelectWorkspace(page, adminEmail, password, 'ADMINISTRATOR');
        await clickSidebar(page, 'Delivery connections', '/webhooks');
        await showChapter(page, 'STEP 4', 'The administrator verifies signed delivery');
        const activityTab = page.getByRole('tab', { name: /^Activity \(/u });
        await clickWithPointer(page, activityTab);
        await humanType(page, page.getByLabel('Search delivery history'), metadata.requestId, {
          delay: 28,
        });
        const ledger = page.getByRole('region', { name: 'Result delivery history table' });
        await expect(ledger).toContainText('Request completed', { timeout: 60_000 });
        await expect(ledger).toContainText(WORKFLOW_NAME);
        await expect(ledger).toContainText('Delivered');
        const details = ledger.getByRole('button', { name: 'Details' }).first();
        if (await details.isVisible()) await clickWithPointer(page, details, { after: 850 });
        await showChapter(page, 'PROOF 04', 'The receiver accepted the signed result', 1700);
        await page.waitForTimeout(900);
      },
    });

    adminState = await saveClip({
      browser,
      name: '05-admin-audit',
      storageState: adminState,
      action: async (page) => {
        if (!metadata.correlationId)
          throw new Error('Correlation ID was not captured after submission');
        await page.goto(`${WEB_ORIGIN}/audit`, { waitUntil: 'domcontentloaded' });
        await installVideoOverlay(page);
        await showChapter(
          page,
          'STEP 5',
          'One correlation ID proves the complete chain of custody',
        );
        await selectWithPointer(page, page.getByLabel('Show activity for'), { label: 'Requests' });
        await humanType(
          page,
          page.getByLabel('Search activity on this page'),
          metadata.correlationId,
          {
            delay: 25,
          },
        );
        const ledger = page.getByRole('list', { name: 'Workspace activity log' });
        await expect(ledger).toContainText('Request completed', { timeout: 40_000 });
        const details = ledger
          .getByRole('button', { name: 'View details for Request completed' })
          .first();
        await clickWithPointer(page, details, { after: 900 });
        const dialog = page.getByRole('dialog', { name: 'Request completed' });
        await expect(dialog).toContainText(metadata.correlationId.slice(0, 8));
        await expect(dialog.getByText(/Technical record/i).first()).toBeVisible();
        await showChapter(
          page,
          'AUDIT PROOF',
          'Actor, event, target, time, and technical evidence remain connected',
          1900,
        );
        await page.waitForTimeout(1100);
      },
    });

    operatorState = await saveClip({
      browser,
      name: '06-operator-notification',
      storageState: operatorState,
      action: async (page) => {
        await page.goto(`${WEB_ORIGIN}/notifications`, { waitUntil: 'domcontentloaded' });
        await installVideoOverlay(page);
        await showChapter(page, 'COMPLETE', 'The requester receives the delivered outcome');
        const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
        if (await refresh.isVisible()) await clickWithPointer(page, refresh, { after: 600 });
        await expect(
          page.getByText('Expense review completed', { exact: true }).first(),
        ).toBeVisible({
          timeout: 30_000,
        });
        const firstNotification = page
          .getByText('Expense review completed', { exact: true })
          .first();
        await smoothScrollTo(page, firstNotification, 250);
        await expect(page.getByText('Delivered', { exact: true }).first()).toBeVisible();
        const openRequest = page.getByRole('link', { name: 'Open request', exact: true }).first();
        await movePointerTo(page, openRequest);
        await page.waitForTimeout(1500);
      },
    });

    metadata.stage = 'complete';
    metadata.status = 'complete';
    await persistMetadata();
  } catch (error) {
    metadata.status = 'failed';
    metadata.error = safeError(error, password);
    await persistMetadata();
    throw error;
  } finally {
    await browser?.close();
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        take: relative(PROJECT_ROOT, TAKE_ROOT).replaceAll('\\', '/'),
        requestId: metadata.requestId,
        correlationId: metadata.correlationId,
        clips: metadata.clips.map((clip) => clip.file),
      },
      null,
      2,
    )}\n`,
  );
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

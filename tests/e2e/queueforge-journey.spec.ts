import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

import { createQueueForgeDataSource } from '../../packages/persistence/dist/index.js';
import {
  cleanupAuthFixtures,
  cleanupTenant,
  cleanupUser,
  cleanupWorkflowFixtures,
  type AuthFixtureCleanupResult,
} from '../database-cleanup.js';

const WEB_ORIGIN = (
  process.env.E2E_BASE_URL ??
  process.env.WEB_ORIGIN ??
  'http://127.0.0.1:3100'
).replace(/\/$/, '');
const API_ORIGIN = (
  process.env.E2E_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://127.0.0.1:3001'
).replace(/\/$/, '');
const SINK_ORIGIN = (
  process.env.E2E_SINK_URL ?? `http://127.0.0.1:${process.env.SINK_PORT ?? '3300'}`
).replace(/\/$/, '');

const ACME_TENANT_ID = '10000000-0000-4000-8000-000000000001';
const SEEDED_WEBHOOK_ENDPOINT_ID = '50000000-0000-4000-8000-000000000001';
const APPROVER_EMAIL = process.env.E2E_APPROVER_EMAIL ?? 'approver@queueforge.local';
const OPERATOR_EMAIL = process.env.E2E_OPERATOR_EMAIL ?? 'operator@queueforge.local';
const E2E_TENANT_SLUG = /^e2e-[a-z0-9]+-[0-9a-f]{8}$/u;
const E2E_VIEWER_EMAIL = /^e2e-viewer-[a-z0-9]+-[0-9a-f]{8}@example\.test$/u;
const BULL_JOB_ID =
  /^qf-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const QUEUE_NAMES = [
  'queueforge.requests',
  'queueforge.webhooks',
  'queueforge.notifications',
] as const;

interface BullJobLike {
  getState(): Promise<string>;
  remove(): Promise<void>;
}

interface BullQueueLike {
  close(): Promise<void>;
  getJob(id: string): Promise<BullJobLike | undefined>;
}

interface BullQueueConstructor {
  new (
    name: string,
    options: {
      readonly connection: {
        readonly enableOfflineQueue: boolean;
        readonly maxRetriesPerRequest: number;
        readonly url: string;
      };
      readonly prefix: string;
    },
  ): BullQueueLike;
}

interface Membership {
  readonly role: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
}

interface AuthSession {
  readonly accessToken: string;
  readonly memberships: readonly Membership[];
  readonly selectedTenant: Membership;
  readonly user: { readonly email: string; readonly id: string };
}

interface WorkflowRequestView {
  readonly attemptCount: number;
  readonly correlationId: string;
  readonly id: string;
  readonly maxAttempts: number;
  readonly status: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly workflowVersionId: string;
}

interface WorkflowView {
  readonly id: string;
  readonly stableKey: string;
  readonly versionId: string;
  readonly versionStatus: string;
}

interface RequestTransition {
  readonly fromStatus: string | null;
  readonly reason?: string | null;
  readonly toStatus: string;
}

interface SinkHistoryEntry {
  readonly accepted: boolean;
  readonly attempt: number | null;
  readonly correlationId: string | null;
  readonly duplicate: boolean;
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly statusCode: number;
}

interface SinkHistory {
  readonly entries: readonly SinkHistoryEntry[];
  readonly total: number;
}

interface CleanupRow {
  readonly id: string;
  readonly value: string;
}

interface JourneyCleanupReport {
  readonly auth: AuthFixtureCleanupResult;
  readonly queueJobsRemoved: number;
}

function requiredEnvironment(name: 'BOOTSTRAP_ADMIN_EMAIL' | 'BOOTSTRAP_ADMIN_PASSWORD'): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be loaded from .env before running the E2E journey`);
  }
  return value;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown teardown error';
}

function isBrowserResponse(response: Response, method: string, pathname: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && url.pathname === pathname;
}

async function responseJson<T>(response: APIResponse | Response): Promise<T> {
  expect(response.ok(), `HTTP ${response.status()} from ${response.url()}`).toBe(true);
  return (await response.json()) as T;
}

async function login(
  page: Page,
  email: string,
  password: string,
  authCorrelationIds: Set<string>,
): Promise<AuthSession> {
  const correlationId = randomUUID();
  authCorrelationIds.add(correlationId);
  await page.goto(`${WEB_ORIGIN}/login`);
  const submitButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submitButton).toBeEnabled();
  await page.getByLabel('Email address').fill(email);
  await page.locator('#password').fill(password);
  await page.setExtraHTTPHeaders({ 'x-correlation-id': correlationId });
  let session: AuthSession;
  try {
    const responsePromise = page.waitForResponse((response) =>
      isBrowserResponse(response, 'POST', '/api/v1/auth/login'),
    );
    await submitButton.click();
    session = await responseJson<AuthSession>(await responsePromise);
  } finally {
    await page.setExtraHTTPHeaders({});
  }
  await expect(page.locator('#tenant-switcher')).toBeVisible();
  return session;
}

async function selectTenant(
  page: Page,
  tenantId: string,
  authCorrelationIds: Set<string>,
): Promise<AuthSession> {
  const correlationId = randomUUID();
  authCorrelationIds.add(correlationId);
  await page.setExtraHTTPHeaders({ 'x-correlation-id': correlationId });
  let session: AuthSession;
  try {
    const responsePromise = page.waitForResponse((response) =>
      isBrowserResponse(response, 'POST', '/api/v1/auth/tenant-select'),
    );
    await page.locator('#tenant-switcher').selectOption(tenantId);
    session = await responseJson<AuthSession>(await responsePromise);
  } finally {
    await page.setExtraHTTPHeaders({});
  }
  await expect(page.locator('#tenant-switcher')).toHaveValue(tenantId);
  return session;
}

async function attachSuccessfulScreenshot(
  page: Page,
  name: string,
  testInfo: TestInfo,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

async function navigateFromSidebar(page: Page, linkName: string, pathname: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Primary navigation' })
    .getByRole('link', { name: linkName, exact: true })
    .click();
  await expect(page).toHaveURL((url) => {
    const normalizedPath = url.pathname.replace(/\/$/, '') || '/';
    return normalizedPath === pathname;
  });
}

async function createAndActivateWorkflow(
  page: Page,
  input: {
    readonly description: string;
    readonly failuresBeforeSuccess: number;
    readonly maxAttempts: number;
    readonly name: string;
    readonly stableKey: string;
    readonly withWebhook: boolean;
  },
): Promise<WorkflowView> {
  await navigateFromSidebar(page, 'Request types', '/workflows');
  await page.getByRole('button', { name: 'New request type' }).click();
  await page.getByLabel('Request type name').fill(input.name);
  await page.getByText('Advanced identifier').click();
  await page.getByLabel('Stable key').fill(input.stableKey);
  await page.getByLabel('When should someone use this?').fill(input.description);

  const createResponsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', '/api/v1/workflows'),
  );
  await page.getByRole('button', { name: 'Create draft' }).click();
  const draft = await responseJson<WorkflowView>(await createResponsePromise);
  await expect(page).toHaveURL(new RegExp(`/workflows/editor/\\?id=${draft.id}$`));

  const requestSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['amount', 'caseId'],
    properties: {
      amount: { type: 'number', minimum: 1 },
      caseId: { type: 'string', minLength: 3, maxLength: 80 },
    },
  };
  const processingConfig = {
    durationMs: input.failuresBeforeSuccess > 1 ? 1_500 : 3_000,
    failuresBeforeSuccess: input.failuresBeforeSuccess,
    maxAttempts: input.maxAttempts,
  };
  const targets = [
    { targetKind: 'processor', position: 0, config: { handler: 'demo' } },
    ...(input.withWebhook
      ? [
          {
            targetKind: 'webhook',
            position: 1,
            config: { endpointId: SEEDED_WEBHOOK_ENDPOINT_ID },
          },
        ]
      : []),
  ];

  const autosaveResponsePromise = page.waitForResponse(async (response) => {
    if (!isBrowserResponse(response, 'PATCH', `/api/v1/workflows/${draft.id}/draft`)) return false;
    const body = response.request().postDataJSON() as {
      readonly processingConfig?: { readonly failuresBeforeSuccess?: number };
    };
    return body.processingConfig?.failuresBeforeSuccess === input.failuresBeforeSuccess;
  });
  const setupNavigation = page.getByRole('navigation', { name: 'Request type setup steps' });
  await setupNavigation.getByRole('link', { name: /Intake form/ }).click();
  await page.getByRole('button', { exact: true, name: 'Advanced JSON' }).click();
  await page.getByLabel('Request schema').fill(JSON.stringify(requestSchema, null, 2));
  await setupNavigation.getByRole('link', { name: /Processing/ }).click();
  await page.getByText('Advanced processing JSON').click();
  await page.getByLabel('Processing policy JSON').fill(JSON.stringify(processingConfig, null, 2));
  await setupNavigation.getByRole('link', { name: /Delivery path/ }).click();
  await page.getByText('Advanced delivery configuration').click();
  await page.getByLabel('Execution targets JSON').fill(JSON.stringify(targets, null, 2));
  await setupNavigation.getByRole('link', { name: /Decision gate/ }).click();
  await page.getByRole('checkbox', { name: 'Accept new requests' }).check();
  await page.getByRole('checkbox', { name: 'Require approval' }).check();
  await page.getByRole('checkbox', { name: 'Prevent self-approval' }).check();
  await responseJson<WorkflowView>(await autosaveResponsePromise);
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByRole('button', { name: 'Publish changes' }).click();
  const activateResponsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', `/api/v1/workflows/${draft.id}/activate`),
  );
  await page.getByRole('button', { name: 'Publish request type' }).click();
  const activated = await responseJson<WorkflowView>(await activateResponsePromise);
  expect(activated.versionStatus).toBe('active');
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
  return activated;
}

async function submitFromUi(
  page: Page,
  workflowName: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<{ readonly replayed: boolean; readonly request: WorkflowRequestView }> {
  await navigateFromSidebar(page, 'Start & track requests', '/requests');
  await page.getByRole('button', { name: 'Start request', exact: true }).first().click();
  const requestTypeSelect = page.getByLabel('What kind of request is this?');
  await expect(requestTypeSelect).toBeEnabled();
  const requestedOption = requestTypeSelect.getByRole('option', {
    exact: true,
    name: workflowName,
  });
  if ((await requestedOption.count()) === 0) {
    await page.getByText('System check request types', { exact: true }).click();
    const systemCheckToggle = page.getByRole('checkbox', {
      name: /Show \d+ system check request types?/,
    });
    await systemCheckToggle.check();
    await expect(requestedOption).toHaveCount(1);
  }
  await requestTypeSelect.selectOption({ label: workflowName });
  const requestDialog = page.getByRole('dialog', { name: 'Start a request' });
  await requestDialog.getByRole('button', { name: 'Continue to details', exact: true }).click();
  for (const [key, value] of Object.entries(payload)) {
    const label = key === 'caseId' ? 'Case Id' : key.charAt(0).toUpperCase() + key.slice(1);
    await requestDialog.getByLabel(label).fill(String(value));
  }
  await requestDialog.getByRole('button', { name: 'Review request', exact: true }).click();
  const responsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', '/api/v1/requests'),
  );
  await requestDialog.getByRole('button', { name: 'Submit request', exact: true }).click();
  const response = await responsePromise;
  const request = await responseJson<WorkflowRequestView>(response);
  await expect(page).toHaveURL(new RegExp(`/requests/detail/\\?id=${request.id}$`));
  return { replayed: response.headers()['idempotency-replayed'] === 'true', request };
}

async function approveFromUi(page: Page, workflowName: string): Promise<void> {
  await navigateFromSidebar(page, 'Approval inbox', '/approvals');
  const refreshResponsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'GET', '/api/v1/approvals'),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await responseJson<unknown>(await refreshResponsePromise);
  await page.getByLabel('Search approvals').fill(workflowName);
  const approveButton = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approveButton).toBeVisible({
    timeout: 30_000,
  });
  await approveButton.click();
  await page
    .getByLabel('Note for the requester')
    .fill('Approved by the end-to-end verification journey.');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/decide'),
  );
  await page.getByRole('button', { name: 'Approve request' }).click();
  await responseJson<unknown>(await responsePromise);
  await expect(
    page.getByText('Request approved. QueueForge will start the next step.'),
  ).toBeVisible();
}

async function getRequest(
  page: Page,
  accessToken: string,
  requestId: string,
): Promise<WorkflowRequestView> {
  const response = await page.request.get(`${API_ORIGIN}/api/v1/requests/${requestId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return responseJson<WorkflowRequestView>(response);
}

async function getTimeline(
  page: Page,
  accessToken: string,
  requestId: string,
): Promise<readonly RequestTransition[]> {
  const response = await page.request.get(`${API_ORIGIN}/api/v1/requests/${requestId}/timeline`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return responseJson<readonly RequestTransition[]>(response);
}

async function pollForStatus(
  page: Page,
  accessToken: string,
  requestId: string,
  expectedStatus: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(async () => (await getRequest(page, accessToken, requestId)).status, { timeout })
    .toBe(expectedStatus);
}

async function closeContext(context: BrowserContext | undefined): Promise<void> {
  if (context !== undefined) await context.close();
}

function loadBullQueueConstructor(): BullQueueConstructor {
  const requireFromWorker = createRequire(resolve(process.cwd(), 'apps/worker/package.json'));
  const module = requireFromWorker('bullmq') as { readonly Queue?: BullQueueConstructor };
  if (module.Queue === undefined) throw new Error('BullMQ Queue constructor is unavailable');
  return module.Queue;
}

async function removeExactQueueJobs(jobIds: readonly string[]): Promise<number> {
  const uniqueJobIds = [...new Set(jobIds)];
  if (uniqueJobIds.some((id) => !BULL_JOB_ID.test(id))) {
    throw new Error('Refusing queue cleanup for a non-deterministic Bull job ID');
  }
  if (uniqueJobIds.length === 0) return 0;
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl.length === 0) {
    throw new Error('REDIS_URL is required for E2E queue cleanup');
  }

  const Queue = loadBullQueueConstructor();
  const queues = QUEUE_NAMES.map(
    (name) =>
      new Queue(name, {
        connection: { enableOfflineQueue: false, maxRetriesPerRequest: 1, url: redisUrl },
        prefix: 'queueforge',
      }),
  );
  let removed = 0;
  const cleanupErrors: unknown[] = [];
  try {
    for (const queue of queues) {
      for (const jobId of uniqueJobIds) {
        const deadline = Date.now() + 30_000;
        let job = await queue.getJob(jobId);
        while (job !== undefined && (await job.getState()) === 'active') {
          if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for active E2E Bull job ${jobId} to settle`);
          }
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
          job = await queue.getJob(jobId);
        }
        if (job === undefined) continue;
        await job.remove();
        if ((await queue.getJob(jobId)) !== undefined) {
          throw new Error(`E2E Bull job ${jobId} remained after exact removal`);
        }
        removed += 1;
      }
    }
  } finally {
    for (const result of await Promise.allSettled(queues.map((queue) => queue.close()))) {
      if (result.status === 'rejected') cleanupErrors.push(result.reason);
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'One or more E2E Bull queue connections failed to close',
    );
  }
  return removed;
}

async function findWorkflowFixtureQueueJobIds(
  owner: { query(sql: string, parameters?: unknown[]): Promise<unknown> },
  requestIds: readonly string[],
): Promise<readonly string[]> {
  if (requestIds.length === 0) return [];
  const rows = (await owner.query(
    `WITH fixture_requests AS (
       SELECT id, correlation_id
       FROM workflow_requests
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
     ), fixture_approvals AS (
       SELECT id FROM approval_tasks
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM fixture_requests)
     ), fixture_notifications AS (
       SELECT id FROM notifications
       WHERE tenant_id = $1 AND request_id IN (SELECT id FROM fixture_requests)
     )
     SELECT id::text AS id
     FROM outbox_events
     WHERE tenant_id = $1
       AND (
         correlation_id IN (SELECT correlation_id FROM fixture_requests)
         OR aggregate_id IN (SELECT id FROM fixture_requests)
         OR aggregate_id IN (SELECT id FROM fixture_approvals)
         OR aggregate_id IN (SELECT id FROM fixture_notifications)
         OR payload ->> 'requestId' IN (SELECT id::text FROM fixture_requests)
         OR payload ->> 'approvalId' IN (SELECT id::text FROM fixture_approvals)
       )
     ORDER BY id`,
    [ACME_TENANT_ID, requestIds],
  )) as unknown as ReadonlyArray<{ readonly id: string }>;
  return rows.map((row) => `qf-${row.id}`);
}

async function cleanupJourneyFixtures({
  authCorrelationIds,
  memberEmail,
  requestIds,
  tenantId,
  tenantSlug,
  workflowKeys,
  workflowTemplateIds,
}: {
  readonly authCorrelationIds: readonly string[];
  readonly memberEmail: string;
  readonly requestIds: readonly string[];
  readonly tenantId?: string;
  readonly tenantSlug: string;
  readonly workflowKeys: readonly string[];
  readonly workflowTemplateIds: readonly string[];
}): Promise<JourneyCleanupReport> {
  if (!E2E_TENANT_SLUG.test(tenantSlug) || !E2E_VIEWER_EMAIL.test(memberEmail)) {
    throw new Error('Refusing E2E cleanup because the fixture identifiers are outside test scope');
  }

  const migrationDatabaseUrl = process.env.MIGRATION_DATABASE_URL;
  if (migrationDatabaseUrl === undefined || migrationDatabaseUrl.length === 0) {
    throw new Error('MIGRATION_DATABASE_URL is required for E2E fixture cleanup');
  }
  const owner = createQueueForgeDataSource({
    applicationName: 'queueforge-e2e-cleanup',
    databaseUrl: migrationDatabaseUrl,
    includeMigrations: false,
  });
  await owner.initialize();
  try {
    const tenants = (await owner.query(
      `SELECT id, slug AS value
       FROM tenants
       WHERE slug = $1`,
      [tenantSlug],
    )) as unknown as readonly CleanupRow[];
    const tenant = tenants[0];
    if (tenants.length > 1) {
      throw new Error('Refusing E2E cleanup because the test slug matched multiple tenants');
    }
    if (tenant !== undefined && tenantId !== undefined && tenant.id !== tenantId) {
      throw new Error('Refusing E2E cleanup because the tenant slug no longer matches its ID');
    }

    const users = (await owner.query(
      `SELECT id, email AS value
       FROM users
       WHERE lower(email) = lower($1)`,
      [memberEmail],
    )) as unknown as readonly CleanupRow[];
    const user = users[0];
    if (user !== undefined && user.value.toLowerCase() !== memberEmail.toLowerCase()) {
      throw new Error('Refusing E2E cleanup because the user ID no longer matches its email');
    }

    const cleanupErrors: unknown[] = [];
    let queueJobsRemoved = 0;
    try {
      const queueJobIdsBefore = await findWorkflowFixtureQueueJobIds(owner, requestIds);
      queueJobsRemoved += await removeExactQueueJobs(queueJobIdsBefore);
      const workflowCleanup = await cleanupWorkflowFixtures(owner, {
        requestIds,
        stableKeys: workflowKeys,
        templateIds: workflowTemplateIds,
        tenantCreation: { id: tenantId, slug: tenantSlug },
        tenantId: ACME_TENANT_ID,
      });
      queueJobsRemoved += await removeExactQueueJobs([
        ...queueJobIdsBefore,
        ...workflowCleanup.queueJobIds,
      ]);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      if (tenant !== undefined) await cleanupTenant(owner, tenant.id);
      if (user !== undefined) {
        const memberships = (await owner.query(
          `SELECT count(*)::integer AS count
           FROM memberships
           WHERE user_id = $1`,
          [user.id],
        )) as unknown as ReadonlyArray<{ readonly count: number }>;
        if ((memberships[0]?.count ?? 0) !== 0) {
          throw new Error('Refusing E2E user cleanup because the user still has a membership');
        }
        await cleanupUser(owner, user.id);
      }
    } catch (error) {
      cleanupErrors.push(error);
    }
    let auth: AuthFixtureCleanupResult = {
      auditEvents: 0,
      refreshFamilies: 0,
      securityEvents: 0,
    };
    try {
      auth = await cleanupAuthFixtures(owner, authCorrelationIds);
    } catch (error) {
      cleanupErrors.push(error);
    }

    const leftovers = (await owner.query(
      `SELECT
         (SELECT count(*)::integer FROM tenants WHERE slug = $1) AS "tenantCount",
         (SELECT count(*)::integer FROM users WHERE lower(email) = lower($2)) AS "userCount"`,
      [tenantSlug, memberEmail],
    )) as unknown as ReadonlyArray<{
      readonly tenantCount: number;
      readonly userCount: number;
    }>;
    if ((leftovers[0]?.tenantCount ?? 1) !== 0 || (leftovers[0]?.userCount ?? 1) !== 0) {
      cleanupErrors.push(new Error('E2E cleanup left disposable tenant or user rows behind'));
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'One or more E2E fixture cleanup scopes failed');
    }
    return { auth, queueJobsRemoved };
  } finally {
    await owner.destroy();
  }
}

test.describe('QueueForge durable user journey', () => {
  test('completes the required 12-step visible flow', async ({ browser, page }, testInfo) => {
    const adminEmail = requiredEnvironment('BOOTSTRAP_ADMIN_EMAIL');
    const sharedBootstrapPassword = requiredEnvironment('BOOTSTRAP_ADMIN_PASSWORD');
    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toLowerCase();
    const tenantName = `E2E Tenant ${suffix}`;
    const tenantSlug = `e2e-${suffix}`;
    const memberEmail = `e2e-viewer-${suffix}@example.test`;
    const memberPassword = `${randomUUID()}Aa1!`;
    const recoveryWorkflowName = `Recovery workflow ${suffix}`;
    const recoveryWorkflowKey = `recovery_${suffix.replaceAll('-', '_')}`;
    const exhaustedWorkflowName = `Exhausted workflow ${suffix}`;
    const exhaustedWorkflowKey = `exhausted_${suffix.replaceAll('-', '_')}`;
    const recoveryPayload = { amount: 42, caseId: `recover-${suffix}` };
    const exhaustedPayload = { amount: 99, caseId: `exhaust-${suffix}` };
    const recoveryIdempotencyKey = randomUUID();
    const exhaustedIdempotencyKey = randomUUID();
    const workflowTemplateIds = new Set<string>();
    const requestIds = new Set<string>();
    const authCorrelationIds = new Set<string>();
    let browserRequestIdempotencyKey = recoveryIdempotencyKey;
    let adminSession!: AuthSession;
    let approverContext: BrowserContext | undefined;
    let operatorContext: BrowserContext | undefined;
    let operatorPage!: Page;
    let operatorSession!: AuthSession;
    let createdTenantId: string | undefined;
    let journeyError: unknown;
    let teardownError: unknown;

    try {
      adminSession = await login(page, adminEmail, sharedBootstrapPassword, authCorrelationIds);
      await test.step('1. Create a tenant and user through authenticated administration surfaces', async () => {
        const response = await page.request.post(`${API_ORIGIN}/api/v1/tenants`, {
          data: { name: tenantName, slug: tenantSlug },
          headers: {
            Authorization: `Bearer ${adminSession.accessToken}`,
            'Idempotency-Key': randomUUID(),
          },
        });
        const tenant = await responseJson<{ readonly tenantId: string }>(response);
        createdTenantId = tenant.tenantId;

        adminSession = await login(page, adminEmail, sharedBootstrapPassword, authCorrelationIds);
        expect(adminSession.memberships.some((item) => item.tenantId === tenant.tenantId)).toBe(
          true,
        );
        adminSession = await selectTenant(page, tenant.tenantId, authCorrelationIds);
        await expect(
          page.getByRole('link', { name: 'Start & track requests', exact: true }),
        ).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Approval inbox', exact: true })).toHaveCount(
          0,
        );
        await navigateFromSidebar(page, 'People & access', '/team');
        await page.getByRole('button', { name: 'Add person' }).click();
        let addPersonDialog = page.getByRole('dialog', { name: 'Add person' });
        await addPersonDialog.getByLabel('Email address').fill(memberEmail);
        await addPersonDialog.getByLabel('Display name').fill(`E2E Viewer ${suffix}`);
        await addPersonDialog.locator('#member-initial-password').fill(memberPassword);
        await addPersonDialog.locator('#member-role').selectOption('viewer');
        await addPersonDialog.getByRole('button', { name: 'Add person', exact: true }).click();
        await expect(addPersonDialog).toBeHidden();

        await page.getByRole('button', { name: 'Add person' }).click();
        addPersonDialog = page.getByRole('dialog', { name: 'Add person' });
        await addPersonDialog.getByLabel('Email address').fill(OPERATOR_EMAIL);
        await addPersonDialog.locator('#member-role').selectOption('operator');
        await addPersonDialog.getByRole('button', { name: 'Add person', exact: true }).click();
        await expect(addPersonDialog).toBeHidden();

        await page.getByLabel('Search members').fill(memberEmail);
        await expect(page.getByRole('table', { name: 'Tenant memberships' })).toContainText(
          memberEmail,
        );
        adminSession = await selectTenant(page, ACME_TENANT_ID, authCorrelationIds);
      });

      await test.step('2. Create and activate immutable recovery and exhaustion workflows', async () => {
        const recovery = await createAndActivateWorkflow(page, {
          description: 'Fails once, then proves bounded queue recovery and signed delivery.',
          failuresBeforeSuccess: 1,
          maxAttempts: 2,
          name: recoveryWorkflowName,
          stableKey: recoveryWorkflowKey,
          withWebhook: true,
        });
        expect(recovery.stableKey).toBe(recoveryWorkflowKey);
        workflowTemplateIds.add(recovery.id);
        const exhausted = await createAndActivateWorkflow(page, {
          description: 'Exhausts its immutable attempt budget for DLQ and manual retry evidence.',
          failuresBeforeSuccess: 10,
          maxAttempts: 2,
          name: exhaustedWorkflowName,
          stableKey: exhaustedWorkflowKey,
          withWebhook: false,
        });
        expect(exhausted.stableKey).toBe(exhaustedWorkflowKey);
        workflowTemplateIds.add(exhausted.id);
        await attachSuccessfulScreenshot(page, '02-activated-workflow.png', testInfo);
      });

      let recoveryRequest!: WorkflowRequestView;
      await test.step('3. Submit a request through the visible intake dialog', async () => {
        if (createdTenantId === undefined) throw new Error('E2E tenant was not created');
        operatorContext = await browser.newContext({ baseURL: WEB_ORIGIN });
        operatorPage = await operatorContext.newPage();
        operatorSession = await login(
          operatorPage,
          OPERATOR_EMAIL,
          sharedBootstrapPassword,
          authCorrelationIds,
        );
        expect(operatorSession.memberships.some((item) => item.tenantId === createdTenantId)).toBe(
          true,
        );
        if (operatorSession.selectedTenant.tenantId !== ACME_TENANT_ID) {
          operatorSession = await selectTenant(operatorPage, ACME_TENANT_ID, authCorrelationIds);
        }
        await expect(
          operatorPage.getByRole('link', { name: 'Start & track requests', exact: true }),
        ).toBeVisible();
        await expect(
          operatorPage.getByRole('link', { name: 'Approval inbox', exact: true }),
        ).toHaveCount(0);
        await operatorPage.route('**/api/v1/requests', async (route) => {
          if (route.request().method() !== 'POST') {
            await route.continue();
            return;
          }
          await route.continue({
            headers: {
              ...route.request().headers(),
              'idempotency-key': browserRequestIdempotencyKey,
            },
          });
        });

        browserRequestIdempotencyKey = recoveryIdempotencyKey;
        const submission = await submitFromUi(operatorPage, recoveryWorkflowName, recoveryPayload);
        expect(submission.replayed).toBe(false);
        recoveryRequest = submission.request;
        requestIds.add(recoveryRequest.id);
        expect(recoveryRequest.status).toBe('pending_approval');
      });

      await test.step('4. Verify the request is visibly pending approval', async () => {
        await expect(
          operatorPage.getByText('Waiting for approval', { exact: true }).first(),
        ).toBeVisible();
        await expect(
          operatorPage.getByRole('list', { name: 'Request status timeline' }),
        ).toContainText('Waiting for approval');
        await expect(
          operatorPage.getByText('Waiting for a decision', { exact: true }).first(),
        ).toBeVisible();
      });

      let approverPage!: Page;
      await test.step('5. Approve with a distinct approver identity', async () => {
        approverContext = await browser.newContext({ baseURL: WEB_ORIGIN });
        approverPage = await approverContext.newPage();
        await login(approverPage, APPROVER_EMAIL, sharedBootstrapPassword, authCorrelationIds);
        await expect(
          approverPage.getByRole('link', { name: 'Approval inbox', exact: true }),
        ).toBeVisible();
        await expect(
          approverPage.getByRole('link', { name: 'Start & track requests', exact: true }),
        ).toHaveCount(0);
        await approveFromUi(approverPage, recoveryWorkflowName);
      });

      await test.step('6. Observe durable queue processing in the request view', async () => {
        await pollForStatus(
          operatorPage,
          operatorSession.accessToken,
          recoveryRequest.id,
          'processing',
          30_000,
        );
        await operatorPage.getByRole('button', { name: 'Refresh' }).click();
        await expect(operatorPage.getByText('In progress', { exact: true }).first()).toBeVisible();
        await pollForStatus(
          operatorPage,
          operatorSession.accessToken,
          recoveryRequest.id,
          'succeeded',
        );
        await operatorPage.getByRole('button', { name: 'Refresh' }).click();
        await expect(operatorPage.getByText('Completed', { exact: true }).first()).toBeVisible();
      });

      let deliveredEventId = '';
      await test.step('7. Confirm the signed outbound webhook reached the real sink', async () => {
        await expect
          .poll(
            async () => {
              const response = await page.request.get(`${SINK_ORIGIN}/history`);
              const history = await responseJson<SinkHistory>(response);
              const entry = history.entries.find(
                (candidate) =>
                  candidate.correlationId === recoveryRequest.correlationId &&
                  candidate.eventType === 'request.succeeded' &&
                  candidate.accepted,
              );
              deliveredEventId = entry?.eventId ?? '';
              return deliveredEventId;
            },
            { timeout: 60_000 },
          )
          .not.toBe('');
        await navigateFromSidebar(page, 'Delivery connections', '/webhooks');
        await page.getByRole('tab', { name: /^Activity / }).click();
        await page.getByLabel('Search delivery history').fill(deliveredEventId);
        const deliveryLedger = page.getByRole('region', {
          name: 'Result delivery history table',
        });
        await expect(deliveryLedger).toContainText('Request completed');
        await expect(deliveryLedger).toContainText('Demo recovery check');
        await expect(deliveryLedger).toContainText('Delivered');
      });

      await test.step('8. Inspect the correlated append-only audit timeline', async () => {
        await navigateFromSidebar(page, 'Activity log', '/audit');
        await page.getByLabel('Show activity for').selectOption({ label: 'Requests' });
        await page.getByLabel('Search activity on this page').fill(recoveryRequest.correlationId);
        const activityLedger = page.getByRole('list', { name: 'Workspace activity log' });
        await expect(activityLedger).toContainText('Request completed');
        await activityLedger
          .getByRole('button', { name: 'View details for Request completed' })
          .first()
          .click();
        const activityDetails = page.getByRole('dialog', { name: 'Request completed' });
        await expect(activityDetails).toContainText(recoveryRequest.correlationId.slice(0, 8));
        await activityDetails.getByRole('button', { name: 'Close dialog' }).click();
        await expect(activityDetails).toBeHidden();
      });

      await test.step('9. Replay the identical request idempotently through the UI', async () => {
        browserRequestIdempotencyKey = recoveryIdempotencyKey;
        const replay = await submitFromUi(operatorPage, recoveryWorkflowName, recoveryPayload);
        requestIds.add(replay.request.id);
        expect(replay.replayed).toBe(true);
        expect(replay.request.id).toBe(recoveryRequest.id);
      });

      await test.step('10. Prove tenant isolation in the visible request detail', async () => {
        if (createdTenantId === undefined) throw new Error('E2E tenant was not created');
        operatorSession = await selectTenant(operatorPage, createdTenantId, authCorrelationIds);
        await operatorPage.goto(`${WEB_ORIGIN}/requests/detail?id=${recoveryRequest.id}`);
        await expect(
          operatorPage.getByRole('heading', { name: 'Record unavailable in this workspace' }),
        ).toBeVisible();
        await expect(
          operatorPage.getByText(/not available in the current workspace/i),
        ).toBeVisible();
        operatorSession = await selectTenant(operatorPage, ACME_TENANT_ID, authCorrelationIds);
      });

      await test.step('11. Verify injected worker failure recovered on the bounded retry', async () => {
        const request = await getRequest(
          operatorPage,
          operatorSession.accessToken,
          recoveryRequest.id,
        );
        expect(request.status).toBe('succeeded');
        expect(request.attemptCount).toBe(2);
        const transitions = await getTimeline(
          operatorPage,
          operatorSession.accessToken,
          recoveryRequest.id,
        );
        expect(transitions.map((item) => item.toStatus)).toEqual(
          expect.arrayContaining(['failed', 'queued', 'processing', 'succeeded']),
        );
        expect(transitions.some((item) => item.reason === 'retry_scheduled')).toBe(true);
        await operatorPage.goto(`${WEB_ORIGIN}/requests/detail?id=${recoveryRequest.id}`);
        const timeline = operatorPage.getByRole('list', { name: 'Request status timeline' });
        await expect(timeline).toContainText('Trying again');
        await expect(timeline).toContainText('QueueForge scheduled another try');
        await expect(timeline).toContainText('Completed');
        await expect(
          operatorPage.getByText('Finished after 2 tries', { exact: true }).first(),
        ).toBeVisible();
        await attachSuccessfulScreenshot(operatorPage, '11-recovered-request.png', testInfo);
      });

      await test.step('12. Exhaust a job into the DLQ and manually retry it', async () => {
        browserRequestIdempotencyKey = exhaustedIdempotencyKey;
        const submission = await submitFromUi(
          operatorPage,
          exhaustedWorkflowName,
          exhaustedPayload,
        );
        expect(submission.replayed).toBe(false);
        requestIds.add(submission.request.id);
        await approveFromUi(approverPage, exhaustedWorkflowName);
        await pollForStatus(
          operatorPage,
          operatorSession.accessToken,
          submission.request.id,
          'dead_lettered',
          90_000,
        );

        await navigateFromSidebar(page, 'Processing health', '/operations');
        await page.getByLabel('Search requests that need attention').fill(submission.request.id);
        const recoveryLedger = page.getByRole('list', {
          name: 'Requests that need attention',
        });
        await expect(recoveryLedger).toContainText('Demo processing-failure check');
        await recoveryLedger.getByRole('button', { name: 'Try again', exact: true }).click();
        const retryResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            /\/api\/v1\/operations\/dead-letters\/[0-9a-f-]+\/retry$/i.test(
              new URL(response.url()).pathname,
            ),
        );
        await page.getByRole('button', { name: 'Try processing again' }).click();
        await responseJson<unknown>(await retryResponsePromise);
        await expect(page.getByText('The request has been queued for another try.')).toBeVisible();

        await expect
          .poll(async () => {
            const transitions = await getTimeline(
              operatorPage,
              operatorSession.accessToken,
              submission.request.id,
            );
            return transitions.some(
              (item) => item.fromStatus === 'dead_lettered' && item.toStatus === 'queued',
            );
          })
          .toBe(true);
        await attachSuccessfulScreenshot(page, '12-manual-dlq-retry.png', testInfo);
        await pollForStatus(
          operatorPage,
          operatorSession.accessToken,
          submission.request.id,
          'dead_lettered',
          90_000,
        );
      });
    } catch (error) {
      journeyError = error;
    } finally {
      const teardownErrors: unknown[] = [];
      try {
        await page.goto('about:blank');
      } catch (error) {
        teardownErrors.push(error);
      }
      for (const context of [approverContext, operatorContext]) {
        try {
          await closeContext(context);
        } catch (error) {
          teardownErrors.push(error);
        }
      }
      try {
        const cleanupReport = await cleanupJourneyFixtures({
          authCorrelationIds: [...authCorrelationIds],
          memberEmail,
          requestIds: [...requestIds],
          tenantId: createdTenantId,
          tenantSlug,
          workflowKeys: [recoveryWorkflowKey, exhaustedWorkflowKey],
          workflowTemplateIds: [...workflowTemplateIds],
        });
        await testInfo.attach('e2e-fixture-cleanup.txt', {
          body: JSON.stringify(cleanupReport, null, 2),
          contentType: 'application/json',
        });
      } catch (error) {
        teardownErrors.push(error);
        await testInfo.attach('e2e-fixture-cleanup-failure.txt', {
          body: [
            'QueueForge E2E fixture cleanup failed.',
            `Tenant ID: ${createdTenantId ?? 'not returned'}`,
            `Tenant slug: ${tenantSlug}`,
            `Viewer email: ${memberEmail}`,
            errorSummary(error),
          ].join('\n'),
          contentType: 'text/plain',
        });
      }
      if (teardownErrors.length > 0) {
        teardownError = new Error(
          `E2E teardown failed: ${teardownErrors.map(errorSummary).join('; ')}`,
        );
      }
    }

    if (journeyError !== undefined && teardownError !== undefined) {
      throw new AggregateError(
        [journeyError, teardownError],
        'The E2E journey and its fixture teardown both failed',
      );
    }
    if (journeyError !== undefined) throw journeyError;
    if (teardownError !== undefined) throw teardownError;
  });
});

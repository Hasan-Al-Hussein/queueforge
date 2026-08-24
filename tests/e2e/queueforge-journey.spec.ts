import { randomUUID } from 'node:crypto';

import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

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
  readonly workflowName: string;
}

interface WorkflowView {
  readonly id: string;
  readonly stableKey: string;
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

function requiredEnvironment(name: 'BOOTSTRAP_ADMIN_EMAIL' | 'BOOTSTRAP_ADMIN_PASSWORD'): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be loaded from .env before running the E2E journey`);
  }
  return value;
}

function isBrowserResponse(response: Response, method: string, pathname: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && url.pathname === pathname;
}

async function responseJson<T>(response: APIResponse | Response): Promise<T> {
  expect(response.ok(), `HTTP ${response.status()} from ${response.url()}`).toBe(true);
  return (await response.json()) as T;
}

async function login(page: Page, email: string, password: string): Promise<AuthSession> {
  await page.goto(`${WEB_ORIGIN}/login`);
  const submitButton = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(submitButton).toBeEnabled();
  await page.getByLabel('Email address').fill(email);
  await page.locator('#password').fill(password);
  const responsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', '/api/v1/auth/login'),
  );
  await submitButton.click();
  const session = await responseJson<AuthSession>(await responsePromise);
  await expect(page.locator('#tenant-switcher')).toBeVisible();
  return session;
}

async function selectTenant(page: Page, tenantId: string): Promise<AuthSession> {
  const responsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', '/api/v1/auth/tenant-select'),
  );
  await page.locator('#tenant-switcher').selectOption(tenantId);
  const session = await responseJson<AuthSession>(await responsePromise);
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
  await page.getByRole('link', { name: linkName, exact: true }).click();
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
  await navigateFromSidebar(page, 'Workflows', '/workflows');
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByLabel('Workflow name').fill(input.name);
  await page.getByLabel('Stable key').fill(input.stableKey);
  await page.getByLabel('Description').fill(input.description);

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
  await page.getByLabel('Request JSON Schema').fill(JSON.stringify(requestSchema, null, 2));
  await page.getByLabel('Processing policy JSON').fill(JSON.stringify(processingConfig, null, 2));
  await page.getByLabel('Execution targets JSON').fill(JSON.stringify(targets, null, 2));
  await page.getByRole('checkbox', { name: 'Accept new requests' }).check();
  await page.getByRole('checkbox', { name: 'Require approval' }).check();
  await page.getByRole('checkbox', { name: 'Prevent self-approval' }).check();
  await responseJson<WorkflowView>(await autosaveResponsePromise);
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByRole('button', { name: 'Activate version' }).click();
  const activateResponsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', `/api/v1/workflows/${draft.id}/activate`),
  );
  await page.getByRole('button', { name: 'Activate immutable version' }).click();
  const activated = await responseJson<WorkflowView>(await activateResponsePromise);
  expect(activated.versionStatus).toBe('active');
  await expect(page.getByText('active', { exact: true }).first()).toBeVisible();
  return activated;
}

async function submitFromUi(
  page: Page,
  workflowKey: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<{ readonly replayed: boolean; readonly request: WorkflowRequestView }> {
  await navigateFromSidebar(page, 'Requests', '/requests');
  await page.getByRole('button', { name: 'Submit request', exact: true }).first().click();
  await page.getByLabel('Workflow key').fill(workflowKey);
  await page.getByLabel('Payload JSON').fill(JSON.stringify(payload, null, 2));
  const responsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'POST', '/api/v1/requests'),
  );
  await page
    .getByRole('dialog', { name: 'Submit workflow request' })
    .getByRole('button', { name: 'Submit request', exact: true })
    .click();
  const response = await responsePromise;
  const request = await responseJson<WorkflowRequestView>(response);
  await expect(page).toHaveURL(new RegExp(`/requests/detail/\\?id=${request.id}$`));
  return { replayed: response.headers()['idempotency-replayed'] === 'true', request };
}

async function approveFromUi(page: Page, workflowName: string): Promise<void> {
  await navigateFromSidebar(page, 'Approvals', '/approvals');
  const refreshResponsePromise = page.waitForResponse((response) =>
    isBrowserResponse(response, 'GET', '/api/v1/approvals'),
  );
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await responseJson<unknown>(await refreshResponsePromise);
  await page.getByLabel('Search approvals').fill(workflowName);
  await expect(page.getByRole('button', { name: `Approve ${workflowName}` })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: `Approve ${workflowName}` }).click();
  await page.getByLabel('Decision note').fill('Approved by the end-to-end verification journey.');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/decide'),
  );
  await page.getByRole('button', { name: 'Record approval' }).click();
  await responseJson<unknown>(await responsePromise);
  await expect(page.getByText('Approval recorded and request queued.')).toBeVisible();
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

test.describe('QueueForge durable user journey', () => {
  test('completes the required 12-step visible flow', async ({ browser, page }, testInfo) => {
    const adminEmail = requiredEnvironment('BOOTSTRAP_ADMIN_EMAIL');
    const sharedBootstrapPassword = requiredEnvironment('BOOTSTRAP_ADMIN_PASSWORD');
    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toLowerCase();
    const tenantName = `E2E Tenant ${suffix}`;
    const tenantSlug = `e2e-${suffix}`;
    const memberEmail = `viewer-${suffix}@example.test`;
    const memberPassword = `${randomUUID()}Aa1!`;
    const recoveryWorkflowName = `Recovery workflow ${suffix}`;
    const recoveryWorkflowKey = `recovery_${suffix.replaceAll('-', '_')}`;
    const exhaustedWorkflowName = `Exhausted workflow ${suffix}`;
    const exhaustedWorkflowKey = `exhausted_${suffix.replaceAll('-', '_')}`;
    const recoveryPayload = { amount: 42, caseId: `recover-${suffix}` };
    const exhaustedPayload = { amount: 99, caseId: `exhaust-${suffix}` };
    const recoveryIdempotencyKey = randomUUID();
    const exhaustedIdempotencyKey = randomUUID();
    let browserRequestIdempotencyKey = recoveryIdempotencyKey;
    let adminSession = await login(page, adminEmail, sharedBootstrapPassword);
    let approverContext: BrowserContext | undefined;

    await page.route('**/api/v1/requests', async (route) => {
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

    try {
      let createdTenantId = '';
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

        adminSession = await login(page, adminEmail, sharedBootstrapPassword);
        expect(adminSession.memberships.some((item) => item.tenantId === createdTenantId)).toBe(
          true,
        );
        adminSession = await selectTenant(page, createdTenantId);
        await navigateFromSidebar(page, 'Team & access', '/team');
        await page.getByRole('button', { name: 'Add member' }).click();
        await page.getByLabel('User email').fill(memberEmail);
        await page.getByLabel('Display name').fill(`E2E Viewer ${suffix}`);
        await page.locator('#member-initial-password').fill(memberPassword);
        await page.locator('#member-role').selectOption('viewer');
        await page.getByRole('button', { name: 'Add membership' }).click();
        await page.getByLabel('Search members').fill(memberEmail);
        await expect(page.getByRole('table', { name: 'Tenant memberships' })).toContainText(
          memberEmail,
        );
        adminSession = await selectTenant(page, ACME_TENANT_ID);
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
        const exhausted = await createAndActivateWorkflow(page, {
          description: 'Exhausts its immutable attempt budget for DLQ and manual retry evidence.',
          failuresBeforeSuccess: 10,
          maxAttempts: 2,
          name: exhaustedWorkflowName,
          stableKey: exhaustedWorkflowKey,
          withWebhook: false,
        });
        expect(exhausted.stableKey).toBe(exhaustedWorkflowKey);
        await attachSuccessfulScreenshot(page, '02-activated-workflow.png', testInfo);
      });

      let recoveryRequest!: WorkflowRequestView;
      await test.step('3. Submit a request through the visible intake dialog', async () => {
        browserRequestIdempotencyKey = recoveryIdempotencyKey;
        const submission = await submitFromUi(page, recoveryWorkflowKey, recoveryPayload);
        expect(submission.replayed).toBe(false);
        recoveryRequest = submission.request;
        expect(recoveryRequest.status).toBe('pending_approval');
      });

      await test.step('4. Verify the request is visibly pending approval', async () => {
        await expect(page.locator('.qf-detail-banner')).toContainText('pending approval');
        await expect(page.getByRole('list', { name: 'Request status timeline' })).toContainText(
          'pending_approval',
        );
      });

      let approverPage!: Page;
      await test.step('5. Approve with a distinct approver identity', async () => {
        approverContext = await browser.newContext({ baseURL: WEB_ORIGIN });
        approverPage = await approverContext.newPage();
        await login(approverPage, APPROVER_EMAIL, sharedBootstrapPassword);
        await approveFromUi(approverPage, recoveryWorkflowName);
      });

      await test.step('6. Observe durable queue processing in the request view', async () => {
        await pollForStatus(
          page,
          adminSession.accessToken,
          recoveryRequest.id,
          'processing',
          30_000,
        );
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.locator('.qf-detail-banner')).toContainText('processing');
        await pollForStatus(page, adminSession.accessToken, recoveryRequest.id, 'succeeded');
        await page.getByRole('button', { name: 'Refresh' }).click();
        await expect(page.locator('.qf-detail-banner')).toContainText('succeeded');
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
        await navigateFromSidebar(page, 'Webhooks', '/webhooks');
        await page.getByLabel('Search deliveries').fill(deliveredEventId);
        const table = page.getByRole('table', { name: 'Outbound webhook deliveries' });
        await expect(table).toContainText('request.succeeded');
        await expect(table).toContainText('delivered');
      });

      await test.step('8. Inspect the correlated append-only audit timeline', async () => {
        await navigateFromSidebar(page, 'Audit trail', '/audit');
        await page.getByLabel('Event type prefix').fill('request.');
        await page.getByLabel('Search audit trail').fill(recoveryRequest.correlationId);
        const table = page.getByRole('table', { name: 'Tenant audit events' });
        await expect(table).toContainText('request.');
        await expect(table).toContainText(recoveryRequest.correlationId.slice(0, 8));
      });

      await test.step('9. Replay the identical request idempotently through the UI', async () => {
        browserRequestIdempotencyKey = recoveryIdempotencyKey;
        const replay = await submitFromUi(page, recoveryWorkflowKey, recoveryPayload);
        expect(replay.replayed).toBe(true);
        expect(replay.request.id).toBe(recoveryRequest.id);
      });

      await test.step('10. Prove tenant isolation in the visible request detail', async () => {
        adminSession = await selectTenant(page, createdTenantId);
        await page.goto(`${WEB_ORIGIN}/requests/detail?id=${recoveryRequest.id}`);
        await expect(page.getByText('Could not load this view')).toBeVisible();
        await expect(page.getByText(/not found|selected tenant/i).first()).toBeVisible();
        adminSession = await selectTenant(page, ACME_TENANT_ID);
      });

      await test.step('11. Verify injected worker failure recovered on the bounded retry', async () => {
        const request = await getRequest(page, adminSession.accessToken, recoveryRequest.id);
        expect(request.status).toBe('succeeded');
        expect(request.attemptCount).toBe(2);
        const transitions = await getTimeline(page, adminSession.accessToken, recoveryRequest.id);
        expect(transitions.map((item) => item.toStatus)).toEqual(
          expect.arrayContaining(['failed', 'queued', 'processing', 'succeeded']),
        );
        expect(transitions.some((item) => item.reason === 'retry_scheduled')).toBe(true);
        await page.goto(`${WEB_ORIGIN}/requests/detail?id=${recoveryRequest.id}`);
        const timeline = page.getByRole('list', { name: 'Request status timeline' });
        await expect(timeline).toContainText('failed');
        await expect(timeline).toContainText('succeeded');
        await expect(page.getByText('2 / 2')).toBeVisible();
        await attachSuccessfulScreenshot(page, '11-recovered-request.png', testInfo);
      });

      await test.step('12. Exhaust a job into the DLQ and manually retry it', async () => {
        browserRequestIdempotencyKey = exhaustedIdempotencyKey;
        const submission = await submitFromUi(page, exhaustedWorkflowKey, exhaustedPayload);
        expect(submission.replayed).toBe(false);
        await approveFromUi(approverPage, exhaustedWorkflowName);
        await pollForStatus(
          page,
          adminSession.accessToken,
          submission.request.id,
          'dead_lettered',
          90_000,
        );

        await navigateFromSidebar(page, 'Queues & DLQ', '/operations');
        await page.getByLabel('Search dead letters').fill(submission.request.id);
        const deadLetterTable = page.getByRole('table', {
          name: 'Dead-lettered workflow requests',
        });
        await expect(deadLetterTable).toContainText(exhaustedWorkflowName);
        await page.getByRole('button', { name: `Retry ${exhaustedWorkflowName}` }).click();
        const retryResponsePromise = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            /\/api\/v1\/operations\/dead-letters\/[0-9a-f-]+\/retry$/i.test(
              new URL(response.url()).pathname,
            ),
        );
        await page.getByRole('button', { name: 'Confirm manual retry' }).click();
        await responseJson<unknown>(await retryResponsePromise);
        await expect(page.getByText('Dead-lettered request re-queued.')).toBeVisible();

        await expect
          .poll(async () => {
            const transitions = await getTimeline(
              page,
              adminSession.accessToken,
              submission.request.id,
            );
            return transitions.some(
              (item) => item.fromStatus === 'dead_lettered' && item.toStatus === 'queued',
            );
          })
          .toBe(true);
        await attachSuccessfulScreenshot(page, '12-manual-dlq-retry.png', testInfo);
      });
    } finally {
      await closeContext(approverContext);
    }
  });
});

import { createHash, randomUUID } from 'node:crypto';

import type { TenantContext, WorkflowRequestStatus } from '../../packages/contracts/src/index.js';
import { hashJson } from '../../packages/domain/dist/index.js';
import {
  AdminStore,
  OperationsStore,
  PersistenceNotFoundError,
  ReadModelStore,
  WebhookSecretStore,
  WorkflowStore,
} from '../../packages/persistence/src/index.js';
import {
  cleanupTenant,
  cleanupUser,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  rejectedPostgresCode,
  type TestDataSource,
} from './database-test-helpers.js';

const MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function userContext(
  tenantId: string,
  principalId: string,
  role: TenantContext['role'],
): TenantContext {
  return {
    principalId,
    principalKind: 'user',
    role,
    sessionId: randomUUID(),
    tenantId,
  };
}

describe('persistence public store integration', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  const tenantIds = new Set<string>();
  const userIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-public-stores-runtime');
    owner = createOwnerDataSource('queueforge-qa-public-stores-owner');
    await Promise.all([runtime.initialize(), owner.initialize()]);
  });

  afterEach(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTenant(owner, tenantId);
    }
    tenantIds.clear();
    for (const userId of userIds) {
      await cleanupUser(owner, userId);
    }
    userIds.clear();
  });

  afterAll(async () => {
    await Promise.all([
      runtime.isInitialized ? runtime.destroy() : Promise.resolve(),
      owner.isInitialized ? owner.destroy() : Promise.resolve(),
    ]);
  });

  it('creates, saves, activates, hashes, and clones immutable workflow targets', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const actorId = randomUUID();
    const context = userContext(tenantId, actorId, 'tenant_admin');
    const store = new WorkflowStore(runtime);
    const stableKey = `qa_${randomUUID().replaceAll('-', '')}`;
    const created = await store.create(context, {
      correlationId: randomUUID(),
      description: 'Initial workflow draft',
      idempotencyKeyHash: sha256(`workflow:${randomUUID()}`),
      name: 'QA durable workflow',
      requestFingerprint: sha256(`workflow-fingerprint:${randomUUID()}`),
      stableKey,
    });
    const webhook = await new WebhookSecretStore(runtime).createEndpoint(
      context,
      {
        correlationId: randomUUID(),
        idempotencyKeyHash: sha256(`workflow-webhook:${randomUUID()}`),
        keyId: 'qa-workflow-v1',
        name: `QA workflow target ${randomUUID()}`,
        requestFingerprint: sha256(`workflow-webhook-fingerprint:${randomUUID()}`),
        signingSecret: `qa-workflow-secret-${randomUUID()}`,
        url: 'http://127.0.0.1:3300/events',
      },
      MASTER_KEY,
    );

    expect(created.targets).toEqual([
      { config: { handler: 'demo' }, position: 0, targetKind: 'processor' },
    ]);
    await expect(store.get({ tenantId }, created.id)).resolves.toMatchObject({
      stableKey,
      versionId: created.versionId,
      versionStatus: 'draft',
    });

    const targets = [
      { config: { handler: 'demo' }, position: 0, targetKind: 'processor' as const },
      {
        config: { endpointId: webhook.endpoint.id },
        position: 1,
        targetKind: 'webhook' as const,
      },
      {
        config: {
          body: 'The workflow completed',
          recipientKind: 'role',
          recipientRef: 'operator',
          title: 'Workflow complete',
        },
        position: 2,
        targetKind: 'notification' as const,
      },
    ];
    const requestSchema = {
      additionalProperties: false,
      properties: { amount: { minimum: 0, type: 'number' } },
      type: 'object',
    };
    const saved = await store.saveDraft({ tenantId }, created.id, actorId, randomUUID(), {
      description: 'Immutable activated workflow',
      expectedRevision: created.revision,
      isEnabled: true,
      name: 'QA durable workflow v1',
      preventSelfApproval: true,
      processingConfig: { durationMs: 50, failuresBeforeSuccess: 0, maxAttempts: 5 },
      requestSchema,
      requiresApproval: true,
      targets,
    });
    expect(saved.targets).toEqual(targets);

    const active = await store.activateDraft({ tenantId }, created.id, actorId, randomUUID());
    expect(active.versionStatus).toBe('active');
    expect(active.targets).toEqual(targets);
    const expectedHash = hashJson({
      description: 'Immutable activated workflow',
      name: 'QA durable workflow v1',
      preventSelfApproval: true,
      processingConfig: { durationMs: 50, failuresBeforeSuccess: 0, maxAttempts: 5 },
      requestSchema,
      requiresApproval: true,
      targets,
    });
    const hashRows = (await runtime.query(
      `SELECT content_hash FROM workflow_versions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, active.versionId],
    )) as unknown as Array<{ content_hash: string }>;
    expect(hashRows[0]?.content_hash).toBe(expectedHash);

    await expect(
      rejectedPostgresCode(
        runtime.query(
          `UPDATE workflow_targets SET config = '{"tampered":true}'::jsonb
           WHERE tenant_id = $1 AND workflow_version_id = $2 AND position = 0`,
          [tenantId, active.versionId],
        ),
      ),
    ).resolves.toBe('55000');

    const cloned = await store.getOrCreateDraft({ tenantId }, created.id, actorId);
    expect(cloned.versionNo).toBe(2);
    expect(cloned.versionStatus).toBe('draft');
    expect(cloned.targets).toEqual(targets);

    await runtime.query(
      `UPDATE workflow_versions SET request_schema = '{"type":"unsupported-type"}'::jsonb
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, cloned.versionId],
    );
    await expect(
      store.activateDraft({ tenantId }, created.id, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await runtime.query(
      `UPDATE workflow_versions SET request_schema = $3::jsonb
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, cloned.versionId, JSON.stringify(requestSchema)],
    );
    await runtime.query(
      `UPDATE workflow_targets SET config = '{"endpointId":"not-a-uuid"}'::jsonb
       WHERE tenant_id = $1 AND workflow_version_id = $2 AND target_kind = 'webhook'`,
      [tenantId, cloned.versionId],
    );
    await expect(
      store.activateDraft({ tenantId }, created.id, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TARGET_INVALID' });
    await runtime.query(
      `UPDATE workflow_targets SET config = jsonb_build_object('endpointId', $3::text)
       WHERE tenant_id = $1 AND workflow_version_id = $2 AND target_kind = 'webhook'`,
      [tenantId, cloned.versionId, webhook.endpoint.id],
    );
    await runtime.query(
      `UPDATE workflow_targets
       SET config = jsonb_build_object(
         'recipientKind', 'user',
         'recipientRef', $3::text,
         'title', 'Invisible notification'
       )
       WHERE tenant_id = $1 AND workflow_version_id = $2 AND target_kind = 'notification'`,
      [tenantId, cloned.versionId, randomUUID()],
    );
    await expect(
      store.activateDraft({ tenantId }, created.id, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TARGET_UNAVAILABLE' });
    await runtime.query(
      `UPDATE workflow_targets
       SET config = '{"recipientKind":"role","recipientRef":"operator","title":"Workflow complete","body":"The workflow completed"}'::jsonb
       WHERE tenant_id = $1 AND workflow_version_id = $2 AND target_kind = 'notification'`,
      [tenantId, cloned.versionId],
    );
    await runtime.query(
      `UPDATE webhook_endpoints SET is_enabled = false WHERE tenant_id = $1 AND id = $2`,
      [tenantId, webhook.endpoint.id],
    );
    await expect(
      store.activateDraft({ tenantId }, created.id, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: 'WORKFLOW_TARGET_UNAVAILABLE' });
  });

  it('enforces tenant administration and keeps membership mutations tenant-scoped', async () => {
    const firstTenantId = randomUUID();
    const secondTenantId = randomUUID();
    tenantIds.add(firstTenantId);
    tenantIds.add(secondTenantId);
    await insertTenant(runtime.manager, firstTenantId);
    await insertTenant(runtime.manager, secondTenantId);
    const userId = randomUUID();
    userIds.add(userId);
    const email = `qa-${userId}@example.test`;
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash, platform_role)
       VALUES ($1, $2, 'QA platform user', 'synthetic-password-hash', 'platform_admin')`,
      [userId, email],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [secondTenantId, userId],
    );
    const admin = new AdminStore(runtime);
    const operations = new OperationsStore(runtime);
    const firstAdmin = userContext(firstTenantId, userId, 'tenant_admin');

    await expect(
      admin.createTenant(firstAdmin, {
        correlationId: randomUUID(),
        idempotencyKeyHash: sha256(`tenant-denied:${randomUUID()}`),
        name: 'Forbidden tenant',
        requestFingerprint: sha256(`tenant-denied-fingerprint:${randomUUID()}`),
        slug: `qa-forbidden-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      operations.updateMembershipRole(firstAdmin, userId, 'operator', randomUUID()),
    ).rejects.toBeInstanceOf(PersistenceNotFoundError);

    await expect(
      admin.createMembership(userContext(firstTenantId, userId, 'viewer'), {
        correlationId: randomUUID(),
        email,
        idempotencyKeyHash: sha256(`member-denied:${randomUUID()}`),
        requestFingerprint: sha256(`member-denied-fingerprint:${randomUUID()}`),
        role: 'operator',
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    await expect(
      admin.createMembership(firstAdmin, {
        correlationId: randomUUID(),
        email,
        idempotencyKeyHash: sha256(`member:${randomUUID()}`),
        requestFingerprint: sha256(`member-fingerprint:${randomUUID()}`),
        role: 'operator',
      }),
    ).resolves.toMatchObject({ id: userId, role: 'operator' });

    const membershipRows = (await runtime.query(
      `SELECT tenant_id, role FROM memberships WHERE user_id = $1 ORDER BY tenant_id`,
      [userId],
    )) as unknown as Array<{ role: string; tenant_id: string }>;
    expect(new Map(membershipRows.map((row) => [row.tenant_id, row.role]))).toEqual(
      new Map([
        [firstTenantId, 'operator'],
        [secondTenantId, 'viewer'],
      ]),
    );

    const createdTenant = await admin.createTenant(
      userContext(firstTenantId, userId, 'platform_admin'),
      {
        correlationId: randomUUID(),
        idempotencyKeyHash: sha256(`tenant:${randomUUID()}`),
        name: 'QA managed tenant',
        requestFingerprint: sha256(`tenant-fingerprint:${randomUUID()}`),
        slug: `qa-managed-${randomUUID()}`,
      },
    );
    const createdTenantId = createdTenant.tenantId;
    if (typeof createdTenantId !== 'string') {
      throw new Error('AdminStore did not return a tenant ID');
    }
    tenantIds.add(createdTenantId);
    const createdMemberships = (await runtime.query(
      `SELECT role FROM memberships WHERE tenant_id = $1 AND user_id = $2`,
      [createdTenantId, userId],
    )) as unknown as Array<{ role: string }>;
    expect(createdMemberships).toEqual([{ role: 'tenant_admin' }]);
  });

  it('locks protected roles and preserves an active tenant administrator under concurrent changes', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const firstAdminId = randomUUID();
    const secondAdminId = randomUUID();
    const lockedApproverId = randomUUID();
    const platformActorId = randomUUID();
    const fixtureUserIds = [firstAdminId, secondAdminId, lockedApproverId, platformActorId];
    fixtureUserIds.forEach((userId) => userIds.add(userId));
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash, platform_role)
       VALUES
         ($1, $5, 'First tenant administrator', 'synthetic-password-hash', NULL),
         ($2, $6, 'Second tenant administrator', 'synthetic-password-hash', NULL),
         ($3, $7, 'Locked demo approver', 'synthetic-password-hash', NULL),
         ($4, $8, 'Platform administrator', 'synthetic-password-hash', 'platform_admin')`,
      [
        firstAdminId,
        secondAdminId,
        lockedApproverId,
        platformActorId,
        `qa-${firstAdminId}@example.test`,
        `qa-${secondAdminId}@example.test`,
        `qa-${lockedApproverId}@example.test`,
        `qa-${platformActorId}@example.test`,
      ],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role, role_locked)
       VALUES
         ($1, $2, 'tenant_admin', false),
         ($1, $3, 'tenant_admin', false),
         ($1, $4, 'approver', true),
         ($1, $5, 'viewer', false)`,
      [tenantId, firstAdminId, secondAdminId, lockedApproverId, platformActorId],
    );
    const operations = new OperationsStore(runtime);
    const readModels = new ReadModelStore(runtime);
    const firstAdminContext = userContext(tenantId, firstAdminId, 'tenant_admin');
    const platformContext = userContext(tenantId, platformActorId, 'platform_admin');

    await expect(
      operations.updateMembershipRole(platformContext, lockedApproverId, 'operator', randomUUID()),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'This membership role is locked' });
    await expect(
      operations.updateMembershipRole(firstAdminContext, firstAdminId, 'operator', randomUUID()),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Your own tenant role cannot be changed',
    });
    await expect(
      operations.updateMembershipRole(platformContext, firstAdminId, 'tenant_admin', randomUUID()),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Membership already has the requested role',
    });

    const concurrentDemotions = await Promise.allSettled([
      operations.updateMembershipRole(platformContext, firstAdminId, 'operator', randomUUID()),
      operations.updateMembershipRole(platformContext, secondAdminId, 'operator', randomUUID()),
    ]);
    const fulfilled = concurrentDemotions.filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof operations.updateMembershipRole>>
      > => result.status === 'fulfilled',
    );
    const rejected = concurrentDemotions.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value).toMatchObject({ role: 'operator', roleLocked: false });
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: 'CONFLICT',
      message: 'The final active tenant administrator cannot be demoted',
    });

    const activeAdminCounts = (await runtime.query(
      `SELECT count(*)::integer AS count
       FROM memberships
       WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active`,
      [tenantId],
    )) as unknown as Array<{ count: number }>;
    expect(activeAdminCounts).toEqual([{ count: 1 }]);

    const team = await readModels.listTeam(platformContext, 1, 25);
    expect(team.items.find((member) => member.id === lockedApproverId)).toMatchObject({
      role: 'approver',
      roleLocked: true,
    });
    const audit = await readModels.listAudit(platformContext, 1, 25, 'membership.role_changed');
    expect(audit.totalItems).toBe(1);
    expect(audit.items[0]).toMatchObject({
      eventType: 'membership.role_changed',
      resourceType: 'membership',
    });
    expect(audit.items[0]?.summary).toEqual(expect.stringContaining('previousRole'));
  });

  it('cancels and retries requests atomically and idempotently', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const workflow = await insertWorkflow(runtime.manager, { tenantId });
    const actorId = randomUUID();
    const context = userContext(tenantId, actorId, 'operator');
    const cancelRequestId = randomUUID();
    const retryRequestId = randomUUID();
    const insertRequest = async (
      requestId: string,
      status: WorkflowRequestStatus,
      attemptCount: number,
    ): Promise<void> => {
      await runtime.query(
        `INSERT INTO workflow_requests
           (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
            payload, payload_hash, correlation_id, submitted_by_principal_id,
            submitted_by_principal_kind, attempt_count, attempt_sequence, max_attempts)
         VALUES ($1, $2, $3, $4, $5, 'system', '{}'::jsonb, $6, $7, $8,
                 'system', $9, $9, 3)`,
        [
          tenantId,
          requestId,
          workflow.templateId,
          workflow.versionId,
          status,
          sha256(`payload:${requestId}`),
          randomUUID(),
          randomUUID(),
          attemptCount,
        ],
      );
    };
    await insertRequest(cancelRequestId, 'queued', 0);
    await insertRequest(retryRequestId, 'dead_lettered', 3);
    await runtime.query(
      `INSERT INTO dead_letters
         (tenant_id, id, resource_kind, resource_id, status, reason_code,
          reason_message, attempt_count)
       VALUES ($1, $2, 'request', $3, 'open', 'QA_EXHAUSTED', 'Synthetic failure', 3)`,
      [tenantId, randomUUID(), retryRequestId],
    );
    const store = new OperationsStore(runtime);
    const cancelInput = {
      correlationId: randomUUID(),
      idempotencyKeyHash: sha256(`cancel:${randomUUID()}`),
      requestFingerprint: sha256(`cancel-fingerprint:${cancelRequestId}`),
    };
    const retryInput = {
      correlationId: randomUUID(),
      idempotencyKeyHash: sha256(`retry:${randomUUID()}`),
      requestFingerprint: sha256(`retry-fingerprint:${retryRequestId}`),
    };

    await expect(
      store.commandRequest(context, cancelRequestId, 'cancel', cancelInput),
    ).resolves.toMatchObject({ id: cancelRequestId, status: 'cancelled' });
    await expect(
      store.commandRequest(context, cancelRequestId, 'cancel', cancelInput),
    ).resolves.toMatchObject({ id: cancelRequestId, status: 'cancelled' });
    await expect(
      store.commandRequest(context, retryRequestId, 'retry', retryInput),
    ).resolves.toMatchObject({ attemptCount: 0, id: retryRequestId, status: 'queued' });
    await expect(
      store.commandRequest(context, retryRequestId, 'retry', retryInput),
    ).resolves.toMatchObject({ attemptCount: 0, id: retryRequestId, status: 'queued' });

    const state = (await runtime.query(
      `SELECT
         (SELECT status FROM workflow_requests WHERE tenant_id = $1 AND id = $2) AS cancel_status,
         (SELECT status FROM workflow_requests WHERE tenant_id = $1 AND id = $3) AS retry_status,
         (SELECT attempt_count FROM workflow_requests WHERE tenant_id = $1 AND id = $3) AS attempts,
         (SELECT attempt_sequence FROM workflow_requests WHERE tenant_id = $1 AND id = $3) AS attempt_sequence,
         (SELECT status FROM dead_letters
          WHERE tenant_id = $1 AND resource_kind = 'request' AND resource_id = $3) AS dlq_status,
         (SELECT count(*)::integer FROM request_transitions
          WHERE tenant_id = $1 AND request_id IN ($2, $3)) AS transitions,
         (SELECT count(*)::integer FROM outbox_events
          WHERE tenant_id = $1 AND aggregate_id = $3 AND event_type = 'request.queued') AS retry_events`,
      [tenantId, cancelRequestId, retryRequestId],
    )) as unknown as Array<{
      attempts: number;
      attempt_sequence: number;
      cancel_status: string;
      dlq_status: string;
      retry_events: number;
      retry_status: string;
      transitions: number;
    }>;
    expect(state[0]).toEqual({
      attempts: 0,
      attempt_sequence: 3,
      cancel_status: 'cancelled',
      dlq_status: 'requeued',
      retry_events: 1,
      retry_status: 'queued',
      transitions: 2,
    });
  });

  it('creates encrypted webhook secrets and updates endpoint metadata', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const context = userContext(tenantId, randomUUID(), 'tenant_admin');
    const store = new WebhookSecretStore(runtime);
    const secret = 'qa-signing-secret-that-is-long-and-never-stored-in-plaintext';
    const input = {
      correlationId: randomUUID(),
      idempotencyKeyHash: sha256(`webhook:${randomUUID()}`),
      keyId: 'qa-key-v1',
      name: 'QA endpoint',
      requestFingerprint: sha256(`webhook-fingerprint:${randomUUID()}`),
      signingSecret: secret,
      url: 'http://127.0.0.1:3300/webhooks',
    };

    const created = await store.createEndpoint(context, input, MASTER_KEY);
    const replayed = await store.createEndpoint(context, input, MASTER_KEY);
    expect(created.replayed).toBe(false);
    expect(created.signingSecret).toBe(secret);
    expect(replayed.endpoint.id).toBe(created.endpoint.id);
    expect(replayed.replayed).toBe(true);
    expect(replayed.signingSecret).toBeNull();
    await expect(
      store.getSigningSecret({ tenantId }, created.endpoint.id, created.endpoint.keyId, MASTER_KEY),
    ).resolves.toBe(secret);
    const encrypted = (await runtime.query(
      `SELECT ciphertext, iv, auth_tag FROM webhook_secrets
       WHERE tenant_id = $1 AND endpoint_id = $2`,
      [tenantId, created.endpoint.id],
    )) as unknown as Array<{ auth_tag: Buffer; ciphertext: Buffer; iv: Buffer }>;
    expect(encrypted[0]?.ciphertext.includes(Buffer.from(secret, 'utf8'))).toBe(false);
    expect(encrypted[0]?.iv).toHaveLength(12);
    expect(encrypted[0]?.auth_tag).toHaveLength(16);

    await expect(
      store.updateEndpoint(
        context,
        created.endpoint.id,
        { active: false, name: 'QA endpoint disabled' },
        randomUUID(),
      ),
    ).resolves.toMatchObject({ active: false, name: 'QA endpoint disabled' });
  });

  it('paginates beyond 100 notifications and keeps role reads personal', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    userIds.add(firstUserId);
    userIds.add(secondUserId);
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash, platform_role)
       VALUES
         ($1, $3, 'First operator', 'synthetic-password-hash', NULL),
         ($2, $4, 'Second operator', 'synthetic-password-hash', NULL)`,
      [
        firstUserId,
        secondUserId,
        `qa-${firstUserId}@example.test`,
        `qa-${secondUserId}@example.test`,
      ],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'operator'), ($1, $3, 'operator')`,
      [tenantId, firstUserId, secondUserId],
    );
    await runtime.query(
      `INSERT INTO notifications
         (tenant_id, id, recipient_kind, recipient_ref, title, body, status, created_at)
       SELECT $1, gen_random_uuid(), 'role', 'operator',
              'Paged notification ' || series::text, 'Synthetic pagination fixture', 'delivered',
              clock_timestamp() - make_interval(secs => series)
       FROM generate_series(1, 105) AS series`,
      [tenantId],
    );
    const personalNotificationId = randomUUID();
    await runtime.query(
      `INSERT INTO notifications
         (tenant_id, id, recipient_kind, recipient_ref, title, body, status, created_at)
       VALUES ($1, $2, 'role', 'operator', 'Role notification', 'Read state is per user',
               'delivered', clock_timestamp())`,
      [tenantId, personalNotificationId],
    );
    const readModels = new ReadModelStore(runtime);
    const firstContext = userContext(tenantId, firstUserId, 'operator');
    const secondContext = userContext(tenantId, secondUserId, 'operator');

    const pageEleven = await readModels.listNotifications(firstContext, 11, 10);
    expect(pageEleven).toMatchObject({
      page: 11,
      pageSize: 10,
      totalItems: 106,
      totalPages: 11,
    });
    expect(pageEleven.items).toHaveLength(6);
    await expect(readModels.listNotifications(firstContext, 12, 10)).resolves.toMatchObject({
      items: [],
      totalItems: 106,
      totalPages: 11,
    });

    await expect(
      new OperationsStore(runtime).markNotificationRead(firstContext, personalNotificationId),
    ).resolves.toMatchObject({ id: personalNotificationId, readAt: expect.any(String) });
    const [firstPage, secondPage] = await Promise.all([
      readModels.listNotifications(firstContext, 1, 10),
      readModels.listNotifications(secondContext, 1, 10),
    ]);
    expect(firstPage.items.find((item) => item.id === personalNotificationId)?.readAt).toEqual(
      expect.any(String),
    );
    expect(secondPage.items.find((item) => item.id === personalNotificationId)?.readAt).toBeNull();
  });

  it('projects delivered approval notifications as successful in list and read responses', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const operatorId = randomUUID();
    userIds.add(operatorId);
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash, platform_role)
       VALUES ($1, $2, 'Notification operator', 'synthetic-password-hash', NULL)`,
      [operatorId, `qa-${operatorId}@example.test`],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $2, 'operator')`,
      [tenantId, operatorId],
    );
    const notificationId = randomUUID();
    await runtime.query(
      `INSERT INTO notifications
         (tenant_id, id, recipient_kind, recipient_ref, title, body, status)
       VALUES
         ($1, $2, 'role', 'operator', 'Approval decision recorded',
          'Request approved', 'delivered')`,
      [tenantId, notificationId],
    );
    const context = userContext(tenantId, operatorId, 'operator');
    const readModels = new ReadModelStore(runtime);

    await expect(readModels.listNotifications(context, 1, 25)).resolves.toMatchObject({
      items: [
        {
          id: notificationId,
          kind: 'success',
          requestId: null,
          workflowName: null,
        },
      ],
    });
    await expect(
      new OperationsStore(runtime).markNotificationRead(context, notificationId),
    ).resolves.toMatchObject({
      id: notificationId,
      kind: 'success',
      readAt: expect.any(String),
      requestId: null,
      workflowName: null,
    });
  });
});

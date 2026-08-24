import { createHash, randomUUID } from 'node:crypto';

import type { AuthSession, TenantContext } from '../../packages/contracts/src/index.js';
import { RequestService } from '../../packages/application/src/index.js';
import {
  ApprovalStore,
  IdentityStore,
  OutboxStore,
  RequestSubmissionStore,
} from '../../packages/persistence/src/index.js';
import {
  cleanupTenant,
  cleanupUser,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  type TestDataSource,
} from './database-test-helpers.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function contextFor(
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

describe('PostgreSQL concurrency invariants', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  const tenantIds = new Set<string>();
  const userIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-concurrency-runtime');
    owner = createOwnerDataSource('queueforge-qa-concurrency-owner');
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

  async function committedWorkflow(requiresApproval: boolean): Promise<{
    readonly actorId: string;
    readonly stableKey: string;
    readonly tenantId: string;
  }> {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    return insertWorkflow(runtime.manager, { requiresApproval, tenantId });
  }

  it('serializes concurrent identical submissions into one request and one replay', async () => {
    const workflow = await committedWorkflow(false);
    const principalId = randomUUID();
    const payload = { amount: 1250, currency: 'AED' };
    const input = {
      context: contextFor(workflow.tenantId, principalId, 'operator'),
      correlationId: randomUUID(),
      endpointScope: 'requests.submit',
      idempotencyKeyHash: sha256(`key:${randomUUID()}`),
      maxAttempts: 3,
      payload,
      payloadHash: sha256(JSON.stringify(payload)),
      requestFingerprint: sha256(JSON.stringify({ payload, workflow: workflow.stableKey })),
      source: 'rest' as const,
      workflowKey: workflow.stableKey,
    };
    const store = new RequestSubmissionStore(runtime);

    const results = await Promise.all([store.submit(input), store.submit(input)]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.statusCode).toBe(201);
    expect(results[1]?.body).toEqual(results[0]?.body);
    const counts = (await runtime.query(
      `SELECT
         (SELECT count(*)::integer FROM workflow_requests WHERE tenant_id = $1) AS requests,
         (SELECT count(*)::integer FROM idempotency_records WHERE tenant_id = $1) AS idempotency,
         (SELECT count(*)::integer FROM outbox_events
          WHERE tenant_id = $1 AND event_type = 'request.queued') AS queued_events,
         (SELECT count(*)::integer FROM audit_events WHERE tenant_id = $1) AS audits`,
      [workflow.tenantId],
    )) as unknown as Array<{
      requests: number;
      idempotency: number;
      queued_events: number;
      audits: number;
    }>;
    expect(counts[0]).toEqual({ audits: 1, idempotency: 1, queued_events: 1, requests: 1 });
  });

  it('converges REST and GraphQL submission onto one durable idempotency result', async () => {
    const workflow = await committedWorkflow(false);
    const context = contextFor(workflow.tenantId, randomUUID(), 'operator');
    const service = new RequestService(
      new RequestSubmissionStore(runtime) as unknown as ConstructorParameters<
        typeof RequestService
      >[0],
      {} as ConstructorParameters<typeof RequestService>[1],
    );
    const command = { payload: { amount: 800 }, workflowKey: workflow.stableKey };
    const idempotencyKey = `cross-transport-${randomUUID()}`;
    const correlationId = randomUUID();

    const first = await service.submit(context, command, idempotencyKey, correlationId, 'rest');
    const replay = await service.submit(context, command, idempotencyKey, correlationId, 'graphql');

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    const counts = (await runtime.query(
      `SELECT
         (SELECT count(*)::integer FROM workflow_requests WHERE tenant_id = $1) AS requests,
         (SELECT count(*)::integer FROM idempotency_records
          WHERE tenant_id = $1 AND endpoint_scope = 'requests:submit') AS idempotency`,
      [workflow.tenantId],
    )) as unknown as Array<{ idempotency: number; requests: number }>;
    expect(counts[0]).toEqual({ idempotency: 1, requests: 1 });
  });

  it('atomically replaces an expired idempotency key and keeps the new result durable', async () => {
    const workflow = await committedWorkflow(false);
    const principalId = randomUUID();
    const keyHash = sha256(`expired-key:${randomUUID()}`);
    await runtime.query(
      `INSERT INTO idempotency_records
         (tenant_id, id, endpoint_scope, key_hash, request_fingerprint,
          principal_id, principal_kind, status, response_status, response_body, expires_at)
       VALUES ($1, gen_random_uuid(), 'requests:submit', $2, $3, $4, 'user',
               'completed', 201, '{"expired":true}'::jsonb,
               clock_timestamp() - interval '1 second')`,
      [workflow.tenantId, keyHash, sha256('expired-fingerprint'), principalId],
    );
    const payload = { amount: 450 };
    const input = {
      context: contextFor(workflow.tenantId, principalId, 'operator'),
      correlationId: randomUUID(),
      endpointScope: 'requests:submit',
      idempotencyKeyHash: keyHash,
      payload,
      payloadHash: sha256(JSON.stringify(payload)),
      requestFingerprint: sha256(JSON.stringify({ payload, workflow: workflow.stableKey })),
      source: 'rest' as const,
      workflowKey: workflow.stableKey,
    };

    const created = await new RequestSubmissionStore(runtime).submit(input);

    expect(created.replayed).toBe(false);
    const records = (await runtime.query(
      `SELECT request_fingerprint, status, (expires_at > clock_timestamp()) AS fresh
       FROM idempotency_records
       WHERE tenant_id = $1 AND endpoint_scope = 'requests:submit' AND key_hash = $2`,
      [workflow.tenantId, keyHash],
    )) as unknown as Array<{ fresh: boolean; request_fingerprint: string; status: string }>;
    expect(records).toEqual([
      { fresh: true, request_fingerprint: input.requestFingerprint, status: 'completed' },
    ]);

    await runtime.query(
      `INSERT INTO idempotency_records
         (tenant_id, id, endpoint_scope, key_hash, request_fingerprint,
          principal_id, principal_kind, status, expires_at)
       SELECT $1, gen_random_uuid(), 'expired:sweep',
              encode(digest(value::text, 'sha256'), 'hex'),
              encode(digest(('fingerprint-' || value)::text, 'sha256'), 'hex'),
              $2, 'user', 'processing', clock_timestamp() - interval '1 hour'
       FROM generate_series(1, 105) AS value`,
      [workflow.tenantId, principalId],
    );
    const nextPayload = { amount: 451 };
    await new RequestSubmissionStore(runtime).submit({
      ...input,
      correlationId: randomUUID(),
      idempotencyKeyHash: sha256(`sweep-trigger:${randomUUID()}`),
      payload: nextPayload,
      payloadHash: sha256(JSON.stringify(nextPayload)),
      requestFingerprint: sha256(
        JSON.stringify({ payload: nextPayload, workflow: workflow.stableKey }),
      ),
    });
    const remaining = (await runtime.query(
      `SELECT count(*)::integer AS count FROM idempotency_records
       WHERE tenant_id = $1 AND endpoint_scope = 'expired:sweep'`,
      [workflow.tenantId],
    )) as unknown as Array<{ count: number }>;
    expect(remaining[0]?.count).toBe(5);
  });

  it('serializes concurrent identical approvals into one decision and one replay', async () => {
    const workflow = await committedWorkflow(true);
    const requesterId = randomUUID();
    const submission = new RequestSubmissionStore(runtime);
    const payload = { amount: 3000 };
    await submission.submit({
      context: contextFor(workflow.tenantId, requesterId, 'operator'),
      correlationId: randomUUID(),
      endpointScope: 'requests.submit',
      idempotencyKeyHash: sha256(`key:${randomUUID()}`),
      payload,
      payloadHash: sha256(JSON.stringify(payload)),
      requestFingerprint: sha256(JSON.stringify({ payload, workflow: workflow.stableKey })),
      source: 'rest',
      workflowKey: workflow.stableKey,
    });
    const tasks = (await runtime.query(`SELECT id FROM approval_tasks WHERE tenant_id = $1`, [
      workflow.tenantId,
    ])) as unknown as Array<{ id: string }>;
    const approvalId = tasks[0]?.id;
    if (approvalId === undefined) {
      throw new Error('Approval fixture was not created');
    }
    const approverId = randomUUID();
    const context = contextFor(workflow.tenantId, approverId, 'approver');
    const store = new ApprovalStore(runtime);
    const correlationId = randomUUID();

    const results = await Promise.all([
      store.decide(context, approvalId, correlationId, {
        decision: 'approved',
        expectedRevision: 1,
      }),
      store.decide(context, approvalId, correlationId, {
        decision: 'approved',
        expectedRevision: 1,
      }),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results.every((result) => result.requestStatus === 'queued')).toBe(true);
    await expect(
      store.decide(
        context,
        approvalId,
        randomUUID(),
        { decision: 'approved', expectedRevision: 999, note: 'different command' },
        {
          idempotencyKeyHash: sha256(`stale-approval:${randomUUID()}`),
          requestFingerprint: sha256(`stale-approval-fingerprint:${randomUUID()}`),
        },
      ),
    ).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await expect(
      store.decide(
        context,
        approvalId,
        randomUUID(),
        { decision: 'approved', expectedRevision: 1, note: 'different command' },
        {
          idempotencyKeyHash: sha256(`different-note:${randomUUID()}`),
          requestFingerprint: sha256(`different-note-fingerprint:${randomUUID()}`),
        },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const counts = (await runtime.query(
      `SELECT
         (SELECT count(*)::integer FROM approval_decisions WHERE tenant_id = $1) AS decisions,
         (SELECT count(*)::integer FROM outbox_events
          WHERE tenant_id = $1 AND event_type = 'request.queued') AS queued_events,
         (SELECT status FROM workflow_requests WHERE tenant_id = $1 LIMIT 1) AS request_status`,
      [workflow.tenantId],
    )) as unknown as Array<{
      decisions: number;
      queued_events: number;
      request_status: string;
    }>;
    expect(counts[0]).toEqual({ decisions: 1, queued_events: 1, request_status: 'queued' });
  });

  it('replays a same-client concurrent rotation but revokes cross-client token reuse', async () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    tenantIds.add(tenantId);
    userIds.add(userId);
    await insertTenant(runtime.manager, tenantId);
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ($1, $2, 'Refresh race user', $3)`,
      [userId, `refresh-${userId}@example.test`, 'synthetic-password-hash'],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1, $2, 'operator')`,
      [tenantId, userId],
    );
    const store = new IdentityStore(runtime);
    const tokenHash = `refresh-token-hash-${randomUUID()}`;
    const familyId = randomUUID();
    const tokenId = randomUUID();
    const session = await store.createRefreshSession({
      familyId,
      tokenId,
      userId,
      selectedTenantId: tenantId,
      csrfHash: 'csrf-hash',
      tokenHash,
      familyExpiresAt: new Date(Date.now() + 60_000),
      tokenExpiresAt: new Date(Date.now() + 60_000),
      userAgentHash: null,
      sourceIp: '127.0.0.1',
      audit: {
        userId,
        tenantId,
        eventType: 'auth.login_succeeded',
        correlationId: randomUUID(),
        sourceIp: '127.0.0.1',
      },
    });

    const issueSession = async ({
      memberships,
      selected,
      user,
    }: Parameters<
      Parameters<IdentityStore['rotateRefresh']>[0]['issueSession']
    >[0]): Promise<AuthSession> => ({
      accessToken: 'synthetic-access-token',
      accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      csrfToken: 'synthetic-csrf-token',
      memberships: [...memberships],
      selectedTenant: selected,
      user: {
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        platformRole: user.platformRole,
      },
    });
    const rotationAudit = {
      correlationId: randomUUID(),
      sourceIp: '127.0.0.1',
      userAgentHash: null,
    };

    await expect(
      store.rotateRefresh({
        tokenId: session.tokenId,
        verifyTokenHash: async (storedHash) => storedHash === tokenHash,
        verifyCsrfHash: (storedHash) => storedHash === 'csrf-hash',
        nextTokenHash: `never-committed-token-hash-${randomUUID()}`,
        nextTokenExpiresAt: new Date(Date.now() + 60_000),
        audit: rotationAudit,
        issueSession: async () => Promise.reject(new Error('JWT signer unavailable')),
      }),
    ).rejects.toThrow('JWT signer unavailable');
    const rolledBack = (await runtime.query(
      `SELECT
         (SELECT consumed_at FROM refresh_tokens WHERE id = $1) AS consumed_at,
         (SELECT count(*)::integer FROM refresh_tokens WHERE parent_token_id = $1) AS children,
         (SELECT count(*)::integer FROM security_events
          WHERE user_id = $2 AND event_type = 'auth.refresh_rotated') AS rotation_events`,
      [session.tokenId, userId],
    )) as unknown as Array<{
      children: number;
      consumed_at: Date | null;
      rotation_events: number;
    }>;
    expect(rolledBack[0]).toEqual({ children: 0, consumed_at: null, rotation_events: 0 });

    const results = await Promise.all([
      store.rotateRefresh({
        tokenId: session.tokenId,
        verifyTokenHash: async (storedHash) => storedHash === tokenHash,
        verifyCsrfHash: (storedHash) => storedHash === 'csrf-hash',
        nextTokenHash: `next-token-hash-a-${randomUUID()}`,
        nextTokenExpiresAt: new Date(Date.now() + 60_000),
        audit: rotationAudit,
        issueSession,
      }),
      store.rotateRefresh({
        tokenId: session.tokenId,
        verifyTokenHash: async (storedHash) => storedHash === tokenHash,
        verifyCsrfHash: (storedHash) => storedHash === 'csrf-hash',
        nextTokenHash: `next-token-hash-b-${randomUUID()}`,
        nextTokenExpiresAt: new Date(Date.now() + 60_000),
        audit: rotationAudit,
        issueSession,
      }),
    ]);

    expect(results.map((result) => result.outcome)).toEqual(['rotated', 'rotated']);
    const rotatedResults = results.filter((result) => result.outcome === 'rotated');
    expect(new Set(rotatedResults.map((result) => result.tokenId))).toHaveProperty('size', 1);
    expect(rotatedResults.map((result) => result.replayed).sort()).toEqual([false, true]);
    const family = (await runtime.query(
      `SELECT revoked_at, revoke_reason FROM refresh_token_families WHERE id = $1`,
      [session.familyId],
    )) as unknown as Array<{ revoked_at: Date | null; revoke_reason: string | null }>;
    expect(family[0]).toEqual({ revoked_at: null, revoke_reason: null });
    const activeTokens = (await runtime.query(
      `SELECT count(*)::integer AS count FROM refresh_tokens
       WHERE family_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
      [session.familyId],
    )) as unknown as Array<{ count: number }>;
    expect(activeTokens[0]?.count).toBe(1);
    await expect(
      store.validateAccessSession(session.familyId, userId, tenantId),
    ).resolves.not.toBeNull();

    await expect(
      store.rotateRefresh({
        tokenId: session.tokenId,
        verifyTokenHash: async (storedHash) => storedHash === tokenHash,
        verifyCsrfHash: (storedHash) => storedHash === 'csrf-hash',
        nextTokenHash: `attacker-token-hash-${randomUUID()}`,
        nextTokenExpiresAt: new Date(Date.now() + 60_000),
        audit: {
          correlationId: randomUUID(),
          sourceIp: '127.0.0.2',
          userAgentHash: 'different-client',
        },
        issueSession,
      }),
    ).resolves.toMatchObject({ outcome: 'reuse' });
    await expect(
      store.validateAccessSession(session.familyId, userId, tenantId),
    ).resolves.toBeNull();
  });

  it('commits tenant selection and its security audit atomically', async () => {
    const firstTenantId = randomUUID();
    const secondTenantId = randomUUID();
    const userId = randomUUID();
    tenantIds.add(firstTenantId);
    tenantIds.add(secondTenantId);
    userIds.add(userId);
    await insertTenant(runtime.manager, firstTenantId);
    await insertTenant(runtime.manager, secondTenantId);
    await runtime.query(
      `INSERT INTO users (id, email, display_name, password_hash)
       VALUES ($1, $2, 'Tenant selection user', $3)`,
      [userId, `selection-${userId}@example.test`, 'synthetic-password-hash'],
    );
    await runtime.query(
      `INSERT INTO memberships (tenant_id, user_id, role)
       VALUES ($1, $3, 'operator'), ($2, $3, 'approver')`,
      [firstTenantId, secondTenantId, userId],
    );
    const store = new IdentityStore(runtime);
    const familyId = randomUUID();
    const tokenId = randomUUID();
    const session = await store.createRefreshSession({
      familyId,
      tokenId,
      userId,
      selectedTenantId: firstTenantId,
      csrfHash: 'selection-csrf-hash',
      tokenHash: `selection-token-hash-${randomUUID()}`,
      familyExpiresAt: new Date(Date.now() + 60_000),
      tokenExpiresAt: new Date(Date.now() + 60_000),
      userAgentHash: null,
      sourceIp: '127.0.0.1',
      audit: {
        userId,
        tenantId: firstTenantId,
        eventType: 'auth.login_succeeded',
        correlationId: randomUUID(),
        sourceIp: '127.0.0.1',
      },
    });

    await expect(
      store.selectTenant(session.familyId, userId, secondTenantId, {
        correlationId: 'not-a-uuid',
        previousTenantId: firstTenantId,
        sourceIp: '127.0.0.1',
      }),
    ).rejects.toBeDefined();
    const afterRejectedAudit = (await runtime.query(
      `SELECT selected_tenant_id FROM refresh_token_families WHERE id = $1`,
      [session.familyId],
    )) as unknown as Array<{ selected_tenant_id: string }>;
    expect(afterRejectedAudit[0]?.selected_tenant_id).toBe(firstTenantId);

    const correlationId = randomUUID();
    await expect(
      store.selectTenant(session.familyId, userId, secondTenantId, {
        correlationId,
        previousTenantId: firstTenantId,
        sourceIp: '127.0.0.1',
      }),
    ).resolves.toMatchObject({ tenantId: secondTenantId, role: 'approver' });
    const committed = (await runtime.query(
      `SELECT
         (SELECT selected_tenant_id FROM refresh_token_families WHERE id = $1) AS selected_tenant_id,
         (SELECT count(*)::integer FROM security_events
          WHERE user_id = $2 AND event_type = 'auth.tenant_selected') AS security_events,
         (SELECT count(*)::integer FROM audit_events
          WHERE tenant_id = $3 AND event_type = 'auth.tenant_selected'
            AND correlation_id = $4) AS audit_events`,
      [session.familyId, userId, secondTenantId, correlationId],
    )) as unknown as Array<{
      selected_tenant_id: string;
      security_events: number;
      audit_events: number;
    }>;
    expect(committed[0]).toEqual({
      selected_tenant_id: secondTenantId,
      security_events: 1,
      audit_events: 1,
    });
  });

  it('uses SKIP LOCKED so two dispatchers claim disjoint outbox batches', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const eventIds = Array.from({ length: 12 }, () => randomUUID());
    for (const eventId of eventIds) {
      await runtime.query(
        `INSERT INTO outbox_events
           (tenant_id, id, event_type, aggregate_type, aggregate_id, correlation_id,
            schema_version, payload, status, attempt_count, max_attempts, available_at)
         VALUES ($1, $2, 'qa.dispatch', 'qa_fixture', $3, $4, 1, '{}'::jsonb,
                 'pending', 0, 3, '-infinity'::timestamptz)`,
        [tenantId, eventId, randomUUID(), randomUUID()],
      );
    }
    const store = new OutboxStore(runtime);
    const firstOwner = `qa-dispatcher-${randomUUID()}`;
    const secondOwner = `qa-dispatcher-${randomUUID()}`;

    const [first, second] = await Promise.all([
      store.claimBatch(firstOwner, 30, 6),
      store.claimBatch(secondOwner, 30, 6),
    ]);
    const firstIds = new Set(first.map((event) => event.id));
    const secondIds = new Set(second.map((event) => event.id));

    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(eventIds));
    expect(new Set(first.map((event) => event.leaseOwner))).toEqual(new Set([firstOwner]));
    expect(new Set(second.map((event) => event.leaseOwner))).toEqual(new Set([secondOwner]));
  });
});

import { createHash, randomUUID } from 'node:crypto';

import {
  RequestExecutionStore,
  WebhookDeliveryStore,
} from '../../packages/persistence/src/index.js';
import {
  cleanupTenant,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  type TestDataSource,
} from './database-test-helpers.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('worker terminal recovery and replay invariants', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  const tenantIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-recovery-runtime');
    owner = createOwnerDataSource('queueforge-qa-recovery-owner');
    await Promise.all([runtime.initialize(), owner.initialize()]);
  });

  afterEach(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTenant(owner, tenantId);
    }
    tenantIds.clear();
  });

  afterAll(async () => {
    await Promise.all([
      runtime.isInitialized ? runtime.destroy() : Promise.resolve(),
      owner.isInitialized ? owner.destroy() : Promise.resolve(),
    ]);
  });

  it('atomically dead-letters an exhausted interrupted request with its receipt', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const workflow = await insertWorkflow(runtime.manager, { tenantId });
    const requestId = randomUUID();
    const correlationId = randomUUID();
    const eventId = randomUUID();
    await runtime.query(
      `INSERT INTO workflow_requests
         (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
          payload, payload_hash, correlation_id, submitted_by_principal_id,
          submitted_by_principal_kind, attempt_count, max_attempts, submitted_at,
          status_changed_at)
       VALUES ($1, $2, $3, $4, 'processing', 'system', '{}'::jsonb, $5, $6, $7,
               'system', 3, 3, clock_timestamp() - interval '5 minutes',
               clock_timestamp() - interval '2 minutes')`,
      [
        tenantId,
        requestId,
        workflow.templateId,
        workflow.versionId,
        sha256('{}'),
        correlationId,
        randomUUID(),
      ],
    );
    const store = new RequestExecutionStore(runtime);
    const receipt = { consumer: 'qa.request-consumer.v1', eventId };

    await expect(
      store.beginOrRecoverAttempt(
        { tenantId },
        requestId,
        `qa-worker-${randomUUID()}`,
        new Date(Date.now() - 30_000),
        receipt,
      ),
    ).resolves.toEqual({ deadLettered: true });
    await expect(
      store.beginOrRecoverAttempt(
        { tenantId },
        requestId,
        `qa-worker-${randomUUID()}`,
        new Date(Date.now() - 30_000),
        receipt,
      ),
    ).resolves.toEqual({ duplicate: true });

    const state = (await runtime.query(
      `SELECT
         (SELECT status FROM workflow_requests WHERE tenant_id = $1 AND id = $2) AS status,
         (SELECT count(*)::integer FROM processed_events
          WHERE tenant_id = $1 AND consumer = $3 AND event_id = $4) AS receipts,
         (SELECT count(*)::integer FROM dead_letters
          WHERE tenant_id = $1 AND resource_kind = 'request' AND resource_id = $2
            AND status = 'open') AS dead_letters,
         (SELECT count(*)::integer FROM request_attempts
          WHERE tenant_id = $1 AND request_id = $2 AND outcome = 'timed_out') AS timed_out_attempts`,
      [tenantId, requestId, receipt.consumer, eventId],
    )) as unknown as Array<{
      status: string;
      receipts: number;
      dead_letters: number;
      timed_out_attempts: number;
    }>;
    expect(state[0]).toEqual({
      dead_letters: 1,
      receipts: 1,
      status: 'dead_lettered',
      timed_out_attempts: 1,
    });
  });

  it('receipts exhausted webhook recovery and replays with stable immutable event data', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const endpointId = randomUUID();
    const deliveryId = randomUUID();
    const stableEventId = randomUUID();
    const correlationId = randomUUID();
    const queueEventId = randomUUID();
    const payload = {
      aggregateId: randomUUID(),
      aggregateType: 'workflow_request',
      correlationId,
      eventId: stableEventId,
      eventType: 'request.succeeded',
      occurredAt: new Date().toISOString(),
      payload: { requestId: randomUUID() },
      schemaVersion: 1,
      tenantId,
    };
    await runtime.query(
      `INSERT INTO webhook_endpoints
         (tenant_id, id, name, url, is_enabled, created_by_principal_id)
       VALUES ($1, $2, 'QA endpoint', 'http://127.0.0.1:3300/webhooks', true, $3)`,
      [tenantId, endpointId, randomUUID()],
    );
    await runtime.query(
      `INSERT INTO webhook_deliveries
         (tenant_id, id, endpoint_id, event_id, generation, target_url, payload_snapshot,
          key_id, status, attempt_count, max_attempts, next_attempt_at, lease_owner, lease_until)
       VALUES ($1, $2, $3, $4, 1, 'http://127.0.0.1:3300/webhooks', $5::jsonb,
               'qa-v1', 'delivering', 2, 2, clock_timestamp(), 'interrupted-worker',
               clock_timestamp() - interval '1 minute')`,
      [tenantId, deliveryId, endpointId, stableEventId, JSON.stringify(payload)],
    );
    const store = new WebhookDeliveryStore(runtime);
    const receipt = { consumer: 'qa.webhook-consumer.v1', eventId: queueEventId };

    await expect(
      store.claimOrRecover({ tenantId }, deliveryId, `qa-worker-${randomUUID()}`, 30, receipt),
    ).resolves.toEqual({ deadLettered: true });
    await expect(
      store.claimOrRecover({ tenantId }, deliveryId, `qa-worker-${randomUUID()}`, 30, receipt),
    ).resolves.toEqual({ duplicate: true });

    const replayInput = {
      actorPrincipalId: randomUUID(),
      actorPrincipalKind: 'user' as const,
      correlationId,
      idempotencyKeyHash: sha256(`replay:${randomUUID()}`),
      requestFingerprint: sha256(`delivery:${deliveryId}`),
    };
    const replayId = await store.createReplay({ tenantId }, deliveryId, replayInput);
    await expect(store.createReplay({ tenantId }, deliveryId, replayInput)).resolves.toBe(replayId);

    const state = (await runtime.query(
      `SELECT original.status AS original_status,
              replay.status AS replay_status,
              replay.event_id = original.event_id AS stable_event,
              replay.payload_snapshot = original.payload_snapshot AS stable_payload,
              replay.generation AS replay_generation,
              dead.status AS dead_letter_status,
              (SELECT count(*)::integer FROM processed_events
               WHERE tenant_id = $1 AND consumer = $4 AND event_id = $5) AS receipts,
              (SELECT count(*)::integer FROM outbox_events
               WHERE tenant_id = $1 AND event_type = 'webhook.delivery.requested'
                 AND aggregate_id = $3) AS replay_events,
              (SELECT count(*)::integer FROM audit_events
               WHERE tenant_id = $1 AND resource_type = 'webhook_delivery'
                 AND resource_id = $2
                 AND event_type = 'webhook.delivery.dead_lettered') AS dead_audits
       FROM webhook_deliveries original
       JOIN webhook_deliveries replay ON replay.tenant_id = original.tenant_id AND replay.id = $3
       JOIN dead_letters dead ON dead.tenant_id = original.tenant_id
         AND dead.resource_kind = 'webhook' AND dead.resource_id = original.id
       WHERE original.tenant_id = $1 AND original.id = $2`,
      [tenantId, deliveryId, replayId, receipt.consumer, queueEventId],
    )) as unknown as Array<{
      original_status: string;
      replay_status: string;
      stable_event: boolean;
      stable_payload: boolean;
      replay_generation: number;
      dead_letter_status: string;
      dead_audits: number;
      receipts: number;
      replay_events: number;
    }>;
    expect(state[0]).toEqual({
      dead_audits: 1,
      dead_letter_status: 'requeued',
      original_status: 'dead',
      receipts: 1,
      replay_events: 1,
      replay_generation: 2,
      replay_status: 'pending',
      stable_event: true,
      stable_payload: true,
    });
  });
});

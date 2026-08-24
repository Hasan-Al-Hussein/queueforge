import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  type EventEnvelope,
} from '../../packages/contracts/src/index.js';
import {
  ProcessedEventStore,
  WebhookDeliveryStore,
  WebhookSecretStore,
} from '../../packages/persistence/dist/index.js';
import { DatabaseWebhookSecretProvider } from '../../apps/worker/src/adapters/database-webhook-secret.provider.js';
import type { WorkerConfiguration } from '../../apps/worker/src/core/ports.js';
import { WebhookJobHandlerService } from '../../apps/worker/src/services/webhook-job-handler.service.js';
import {
  createWebhookSinkServer,
  type WebhookSinkServer,
} from '../../apps/webhook-sink/src/sink-server.js';
import {
  cleanupTenant,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  type TestDataSource,
} from './database-test-helpers.js';

const SIGNING_SECRET = 'queueforge-qa-webhook-signing-secret-at-least-32-characters';
const MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const KEY_ID = 'qa-v1';

describe('signed outbound webhook retry integration', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  let sink: WebhookSinkServer | undefined;
  const tenantIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-webhook-runtime');
    owner = createOwnerDataSource('queueforge-qa-webhook-owner');
    await Promise.all([runtime.initialize(), owner.initialize()]);
  });

  afterEach(async () => {
    if (sink !== undefined) {
      await sink.close();
      sink = undefined;
    }
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

  it('signs exact stable bytes, retries a 503, and atomically receipts delivery', async () => {
    sink = createWebhookSinkServer({
      clockSkewSeconds: 300,
      host: '127.0.0.1',
      keyId: KEY_ID,
      port: 0,
      secret: SIGNING_SECRET,
    });
    const sinkPort = await sink.listen();
    const targetUrl = `http://127.0.0.1:${sinkPort}/webhooks`;
    const control = await fetch(`http://127.0.0.1:${sinkPort}/controls/failures`, {
      body: JSON.stringify({ failNext: 1, statusCode: 503 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(control.status).toBe(200);

    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const endpointId = randomUUID();
    const deliveryId = randomUUID();
    const stableEventId = randomUUID();
    const correlationId = randomUUID();
    const queueEventId = randomUUID();
    const requestId = randomUUID();
    const outbound: EventEnvelope = {
      aggregateId: requestId,
      aggregateType: 'workflow_request',
      correlationId,
      eventId: stableEventId,
      eventType: EVENT_TYPES.requestSucceeded,
      occurredAt: new Date().toISOString(),
      payload: { attemptNo: 1, requestId },
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId,
    };
    const queueEvent: EventEnvelope = {
      aggregateId: deliveryId,
      aggregateType: 'webhook_delivery',
      correlationId,
      eventId: queueEventId,
      eventType: EVENT_TYPES.webhookDeliveryRequested,
      occurredAt: new Date().toISOString(),
      payload: { deliveryId, eventId: stableEventId, requestId },
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId,
    };
    await runtime.query(
      `INSERT INTO webhook_endpoints
         (tenant_id, id, name, url, is_enabled, created_by_principal_id)
       VALUES ($1, $2, 'QA signed endpoint', $3, true, $4)`,
      [tenantId, endpointId, targetUrl, randomUUID()],
    );
    const secretStore = new WebhookSecretStore(runtime);
    await secretStore.storeActiveSecret(
      { tenantId },
      endpointId,
      KEY_ID,
      SIGNING_SECRET,
      MASTER_KEY,
    );
    await runtime.query(
      `INSERT INTO webhook_deliveries
         (tenant_id, id, endpoint_id, event_id, generation, target_url, payload_snapshot,
          key_id, status, attempt_count, max_attempts, next_attempt_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, $7, 'pending', 0, 3,
               clock_timestamp())`,
      [
        tenantId,
        deliveryId,
        endpointId,
        stableEventId,
        targetUrl,
        JSON.stringify(outbound),
        KEY_ID,
      ],
    );

    const configuration = {
      allowPrivateNetworks: true,
      allowedWebhookHosts: new Set(['127.0.0.1']),
      concurrency: 1,
      databaseUrl: process.env['DATABASE_URL'] ?? '',
      heartbeatIntervalMs: 10_000,
      leaseSeconds: 30,
      outboxPollIntervalMs: 1_000,
      redisUrl: process.env['REDIS_URL'] ?? '',
      requestTimeoutMs: 5_000,
      webhookMasterKeyBase64: MASTER_KEY,
      webhookTimeoutMs: 2_000,
    } satisfies WorkerConfiguration;
    const handler = new WebhookJobHandlerService(
      new ProcessedEventStore(runtime),
      new WebhookDeliveryStore(runtime),
      new DatabaseWebhookSecretProvider(secretStore, configuration),
      configuration,
      `qa-worker-${randomUUID()}`,
    );
    const job = { data: queueEvent } as Parameters<WebhookJobHandlerService['handle']>[0];

    await expect(handler.handle(job)).rejects.toMatchObject({
      code: 'WEBHOOK_RETRY_SCHEDULED',
    });
    const retryRows = (await runtime.query(
      `SELECT status, next_attempt_at FROM webhook_deliveries
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, deliveryId],
    )) as unknown as Array<{ status: string; next_attempt_at: Date }>;
    expect(retryRows[0]?.status).toBe('retry');
    const waitMs = Math.max(
      0,
      (retryRows[0]?.next_attempt_at.getTime() ?? Date.now()) - Date.now(),
    );
    await delay(waitMs + 25);

    await expect(handler.handle(job)).resolves.toBeUndefined();

    const history = sink.snapshot();
    expect(history.map((entry) => entry.attempt)).toEqual([1, 2]);
    expect(history.map((entry) => entry.eventId)).toEqual([stableEventId, stableEventId]);
    expect(history.map((entry) => entry.statusCode)).toEqual([503, 202]);
    expect(history.map((entry) => entry.accepted)).toEqual([false, true]);
    const state = (await runtime.query(
      `SELECT delivery.status,
              (SELECT count(*)::integer FROM webhook_delivery_attempts attempt
               WHERE attempt.tenant_id = delivery.tenant_id
                 AND attempt.delivery_id = delivery.id) AS attempts,
              (SELECT count(*)::integer FROM processed_events receipt
               WHERE receipt.tenant_id = delivery.tenant_id
                 AND receipt.consumer = 'queueforge.webhook-delivery.v1'
                 AND receipt.event_id = $3) AS receipts,
              (SELECT array_agg(audit.event_type ORDER BY audit.occurred_at, audit.id)
               FROM audit_events audit
               WHERE audit.tenant_id = delivery.tenant_id
                 AND audit.resource_type = 'webhook_delivery'
                 AND audit.resource_id = delivery.id) AS audit_events
       FROM webhook_deliveries delivery
       WHERE delivery.tenant_id = $1 AND delivery.id = $2`,
      [tenantId, deliveryId, queueEventId],
    )) as unknown as Array<{
      attempts: number;
      audit_events: string[];
      receipts: number;
      status: string;
    }>;
    expect(state[0]).toEqual({
      attempts: 2,
      audit_events: ['webhook.delivery.retry_scheduled', 'webhook.delivery.delivered'],
      receipts: 1,
      status: 'delivered',
    });
  });
});

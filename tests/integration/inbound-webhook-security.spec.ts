import { createHash, createHmac, randomUUID } from 'node:crypto';

import { InboundWebhookService } from '../../packages/application/dist/index.js';
import { loadRuntimeEnvironment } from '../../packages/config/dist/index.js';
import {
  RequestSubmissionStore,
  WebhookSecretStore,
} from '../../packages/persistence/dist/index.js';
import {
  cleanupTenant,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  type TestDataSource,
} from './database-test-helpers.js';

const MASTER_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const SIGNING_SECRET = 'qa-inbound-signing-secret-that-is-at-least-thirty-two-characters';
const KEY_ID = 'qa-inbound-v1';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sign(
  rawBody: Buffer,
  timestamp: string,
  nonce: string,
  eventId: string,
  idempotencyKey: string,
  keyId = KEY_ID,
): string {
  return createHmac('sha256', SIGNING_SECRET)
    .update(Buffer.from(`${timestamp}.${nonce}.${eventId}.${idempotencyKey}.${keyId}.`, 'utf8'))
    .update(rawBody)
    .digest('hex');
}

describe('inbound webhook HMAC and replay integration', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;
  const tenantIds = new Set<string>();

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-inbound-runtime');
    owner = createOwnerDataSource('queueforge-qa-inbound-owner');
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

  it('rejects bad and stale signatures, blocks nonce replay, and deduplicates a signed retry', async () => {
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtime.manager, tenantId);
    const workflow = await insertWorkflow(runtime.manager, { tenantId });
    const endpointStore = new WebhookSecretStore(runtime);
    const endpoint = await endpointStore.createEndpoint(
      {
        principalId: randomUUID(),
        principalKind: 'user',
        role: 'tenant_admin',
        tenantId,
      },
      {
        correlationId: randomUUID(),
        idempotencyKeyHash: sha256(`endpoint:${randomUUID()}`),
        keyId: KEY_ID,
        name: 'QA inbound endpoint',
        requestFingerprint: sha256(`endpoint-fingerprint:${randomUUID()}`),
        signingSecret: SIGNING_SECRET,
        url: 'http://127.0.0.1:3300/webhooks',
      },
      MASTER_KEY,
    );
    const environment = loadRuntimeEnvironment({
      ...process.env,
      WEBHOOK_CLOCK_SKEW_SECONDS: '60',
      WEBHOOK_MASTER_KEY: MASTER_KEY,
    });
    const service = new InboundWebhookService(
      endpointStore,
      new RequestSubmissionStore(runtime),
      environment,
    );
    const rawBody = Buffer.from(
      JSON.stringify({ payload: { amount: 42 }, workflowKey: workflow.stableKey }),
      'utf8',
    );
    const eventId = randomUUID();
    const idempotencyKey = `qa-idempotency-${randomUUID()}`;
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const firstNonce = `qa-nonce-${randomUUID()}`;
    const baseHeaders = {
      eventId,
      idempotencyKey,
      keyId: KEY_ID,
      nonce: firstNonce,
      timestamp,
    };

    await expect(
      service.accept(
        `qa-${tenantId}`,
        endpoint.endpoint.id,
        rawBody,
        { ...baseHeaders, signature: '0'.repeat(64) },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });

    const staleTimestamp = String(Number(timestamp) - 61);
    await expect(
      service.accept(
        `qa-${tenantId}`,
        endpoint.endpoint.id,
        rawBody,
        {
          ...baseHeaders,
          signature: sign(rawBody, staleTimestamp, firstNonce, eventId, idempotencyKey),
          timestamp: staleTimestamp,
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });

    const accepted = await service.accept(
      `qa-${tenantId}`,
      endpoint.endpoint.id,
      rawBody,
      {
        ...baseHeaders,
        signature: sign(rawBody, timestamp, firstNonce, eventId, idempotencyKey),
      },
      randomUUID(),
    );
    expect(accepted).toMatchObject({ accepted: true, duplicate: false, eventId });

    await expect(
      service.accept(
        `qa-${tenantId}`,
        endpoint.endpoint.id,
        rawBody,
        {
          ...baseHeaders,
          signature: sign(rawBody, timestamp, firstNonce, eventId, idempotencyKey),
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_REPLAY_DETECTED' });

    const retryNonce = `qa-nonce-${randomUUID()}`;
    const retry = await service.accept(
      `qa-${tenantId}`,
      endpoint.endpoint.id,
      rawBody,
      {
        ...baseHeaders,
        nonce: retryNonce,
        signature: sign(rawBody, timestamp, retryNonce, eventId, idempotencyKey),
      },
      randomUUID(),
    );
    expect(retry).toEqual({
      accepted: true,
      duplicate: true,
      eventId,
      requestId: accepted.requestId,
    });

    const concurrentEventId = randomUUID();
    const concurrentIdempotencyKey = `qa-idempotency-${randomUUID()}`;
    const concurrentBody = Buffer.from(
      JSON.stringify({ payload: { amount: 43 }, workflowKey: workflow.stableKey }),
      'utf8',
    );
    const concurrentNonces = [`qa-nonce-${randomUUID()}`, `qa-nonce-${randomUUID()}`] as const;
    const concurrentResults = await Promise.all(
      concurrentNonces.map((nonce) =>
        service.accept(
          `qa-${tenantId}`,
          endpoint.endpoint.id,
          concurrentBody,
          {
            eventId: concurrentEventId,
            idempotencyKey: concurrentIdempotencyKey,
            keyId: KEY_ID,
            nonce,
            signature: sign(
              concurrentBody,
              timestamp,
              nonce,
              concurrentEventId,
              concurrentIdempotencyKey,
            ),
            timestamp,
          },
          randomUUID(),
        ),
      ),
    );
    expect(concurrentResults.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(new Set(concurrentResults.map((result) => result.requestId))).toHaveProperty('size', 1);

    const state = (await runtime.query(
      `SELECT
         (SELECT count(*)::integer FROM workflow_requests
          WHERE tenant_id = $1 AND source = 'inbound_webhook') AS requests,
         (SELECT count(*)::integer FROM inbound_webhook_receipts
          WHERE tenant_id = $1 AND endpoint_id = $2) AS receipts,
         (SELECT count(*)::integer FROM inbound_webhook_replay_keys
          WHERE tenant_id = $1 AND endpoint_id = $2) AS replay_keys,
         (SELECT count(*)::integer FROM outbox_events
          WHERE tenant_id = $1 AND aggregate_id = $3 AND event_type = 'request.queued') AS queued_events`,
      [tenantId, endpoint.endpoint.id, accepted.requestId],
    )) as unknown as Array<{
      queued_events: number;
      receipts: number;
      replay_keys: number;
      requests: number;
    }>;
    expect(state[0]).toEqual({ queued_events: 1, receipts: 2, replay_keys: 4, requests: 2 });
  });
});

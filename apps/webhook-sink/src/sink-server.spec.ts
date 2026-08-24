import { randomUUID } from 'node:crypto';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  OUTBOUND_WEBHOOK_HEADERS,
  type EventEnvelope,
} from '@queueforge/contracts';

import { createWebhookSinkServer, type WebhookSinkServer } from './sink-server.js';
import { createOutboundSignature } from './signature.js';

const SECRET = 'sink-test-secret-that-is-at-least-32-characters';
const KEY_ID = 'test-v1';
const NOW_MS = 1_700_000_000_000;

function fixture(
  eventId = randomUUID(),
  payload: Record<string, unknown> = { result: 'ok' },
): EventEnvelope {
  return {
    aggregateId: randomUUID(),
    aggregateType: 'workflow_request',
    correlationId: randomUUID(),
    eventId,
    eventType: EVENT_TYPES.requestSucceeded,
    occurredAt: new Date(NOW_MS).toISOString(),
    payload,
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: randomUUID(),
  };
}

async function postSignedEvent(
  baseUrl: string,
  event: EventEnvelope,
  options: { readonly attempt?: number; readonly timestamp?: number } = {},
): Promise<Response> {
  const rawBody = Buffer.from(JSON.stringify(event), 'utf8');
  const attempt = options.attempt ?? 1;
  const timestamp = options.timestamp ?? Math.floor(NOW_MS / 1_000);
  const signature = createOutboundSignature({
    attempt,
    eventId: event.eventId,
    rawBody,
    secret: SECRET,
    timestamp,
  });
  return fetch(`${baseUrl}/webhooks`, {
    body: rawBody,
    headers: {
      'content-type': 'application/json',
      [OUTBOUND_WEBHOOK_HEADERS.attempt]: String(attempt),
      [OUTBOUND_WEBHOOK_HEADERS.eventId]: event.eventId,
      [OUTBOUND_WEBHOOK_HEADERS.keyId]: KEY_ID,
      [OUTBOUND_WEBHOOK_HEADERS.signature]: signature,
      [OUTBOUND_WEBHOOK_HEADERS.timestamp]: String(timestamp),
    },
    method: 'POST',
  });
}

describe('local webhook sink', () => {
  let sink: WebhookSinkServer;
  let baseUrl: string;

  beforeEach(async () => {
    sink = createWebhookSinkServer({
      clockSkewSeconds: 300,
      host: '127.0.0.1',
      keyId: KEY_ID,
      now: () => NOW_MS,
      port: 0,
      secret: SECRET,
    });
    const port = await sink.listen();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await sink.close();
  });

  it('accepts once, deduplicates the stable event, and rejects an event-id collision', async () => {
    const eventId = randomUUID();
    const event = fixture(eventId);

    const first = await postSignedEvent(baseUrl, event);
    const duplicate = await postSignedEvent(baseUrl, event, { attempt: 2 });
    const collision = await postSignedEvent(baseUrl, fixture(eventId, { result: 'changed' }), {
      attempt: 3,
    });

    expect(first.status).toBe(202);
    expect(await first.json()).toEqual(
      expect.objectContaining({ accepted: true, duplicate: false, eventId }),
    );
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual(
      expect.objectContaining({ accepted: true, duplicate: true, eventId }),
    );
    expect(collision.status).toBe(409);
    expect(sink.snapshot()).toHaveLength(3);
  });

  it('rejects a correctly signed request outside the configured clock window', async () => {
    const response = await postSignedEvent(baseUrl, fixture(), {
      timestamp: Math.floor(NOW_MS / 1_000) - 301,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'WEBHOOK_TIMESTAMP_INVALID' } });
  });

  it('injects bounded failures without marking the event accepted, then accepts retry', async () => {
    const control = await fetch(`${baseUrl}/controls/failures`, {
      body: JSON.stringify({ failNext: 1, statusCode: 503 }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(control.status).toBe(200);

    const event = fixture();
    const failed = await postSignedEvent(baseUrl, event);
    const retried = await postSignedEvent(baseUrl, event, { attempt: 2 });

    expect(failed.status).toBe(503);
    expect(retried.status).toBe(202);
    expect(sink.snapshot().map((entry) => entry.accepted)).toEqual([false, true]);
  });

  it('keeps mutation controls disabled in production mode', async () => {
    await sink.close();
    sink = createWebhookSinkServer({
      clockSkewSeconds: 300,
      host: '127.0.0.1',
      keyId: KEY_ID,
      now: () => NOW_MS,
      port: 0,
      production: true,
      secret: SECRET,
    });
    const port = await sink.listen();
    baseUrl = `http://127.0.0.1:${port}`;

    const response = await fetch(`${baseUrl}/reset`, { method: 'POST' });
    expect(response.status).toBe(403);
  });
});

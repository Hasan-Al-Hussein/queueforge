import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';

import {
  EventEnvelopeSchema,
  OUTBOUND_WEBHOOK_HEADERS,
  type EventEnvelope,
} from '@queueforge/contracts';
import { z } from 'zod';

import { verifyOutboundSignature } from './signature.js';

export const SINK_MAX_BODY_BYTES = 1_048_576;
const MAX_HISTORY_ENTRIES = 500;
const MAX_DEDUPE_ENTRIES = 10_000;

const FailureControlSchema = z
  .object({
    delayMs: z.number().int().min(0).max(5_000).default(0),
    failNext: z.number().int().min(0).max(100),
    statusCode: z
      .union([
        z.literal(408),
        z.literal(409),
        z.literal(429),
        z.literal(500),
        z.literal(502),
        z.literal(503),
      ])
      .default(503),
  })
  .strict();

interface FailureControl {
  delayMs: number;
  failNext: number;
  statusCode: 408 | 409 | 429 | 500 | 502 | 503;
}

export interface SinkOptions {
  readonly clockSkewSeconds: number;
  readonly controlToken?: string;
  readonly host: string;
  readonly keyId: string;
  readonly maxBodyBytes?: number;
  readonly now?: () => number;
  readonly port: number;
  readonly production?: boolean;
  readonly secret: string;
}

export interface SinkHistoryEntry {
  readonly accepted: boolean;
  readonly attempt: number | null;
  readonly correlationId: string | null;
  readonly duplicate: boolean;
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly receivedAt: string;
  readonly requestId: string;
  readonly statusCode: number;
}

interface DedupeEntry {
  readonly digest: Buffer;
  readonly firstAcceptedAt: string;
}

interface MutableSinkState {
  failure: FailureControl;
  readonly history: SinkHistoryEntry[];
  readonly received: Map<string, DedupeEntry>;
}

class PayloadTooLargeError extends Error {}

function appendBounded<T>(items: T[], value: T, maxEntries: number): void {
  items.push(value);
  if (items.length > maxEntries) {
    items.splice(0, items.length - maxEntries);
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(serialized),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  });
  response.end(serialized);
}

function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]{0,11}$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function normalizeRemoteAddress(value: string | undefined): string {
  return value !== undefined && value.startsWith('::ffff:') ? value.slice(7) : (value ?? '');
}

function isLoopbackAddress(value: string | undefined): boolean {
  const normalized = normalizeRemoteAddress(value);
  return normalized === '::1' || normalized.startsWith('127.');
}

function controlAllowed(request: IncomingMessage, options: SinkOptions): boolean {
  if (options.production === true) {
    return false;
  }
  if (options.controlToken !== undefined) {
    const supplied = header(request, 'x-queueforge-control-token');
    if (supplied === undefined) {
      return false;
    }
    const expectedBuffer = Buffer.from(options.controlToken, 'utf8');
    const suppliedBuffer = Buffer.from(supplied, 'utf8');
    return (
      expectedBuffer.length === suppliedBuffer.length &&
      timingSafeEqual(expectedBuffer, suppliedBuffer)
    );
  }
  return isLoopbackAddress(request.socket.remoteAddress);
}

async function readRawBody(request: IncomingMessage, maxBodyBytes: number): Promise<Buffer> {
  const declaredLength = header(request, 'content-length');
  if (declaredLength !== undefined) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBodyBytes) {
      throw new PayloadTooLargeError('Request body exceeds the configured limit');
    }
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let tooLarge = false;

    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += buffer.length;
      if (length > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(buffer);
    });
    request.once('aborted', () => reject(new Error('Request aborted')));
    request.once('error', reject);
    request.once('end', () => {
      if (tooLarge) {
        reject(new PayloadTooLargeError('Request body exceeds the configured limit'));
        return;
      }
      resolve(Buffer.concat(chunks, length));
    });
  });
}

function parsePath(request: IncomingMessage): string {
  return new URL(request.url ?? '/', 'http://queueforge.invalid').pathname;
}

function recordHistory(
  state: MutableSinkState,
  entry: Omit<SinkHistoryEntry, 'correlationId' | 'receivedAt' | 'requestId'> & {
    readonly correlationId?: string;
  },
  nowMs: number,
): SinkHistoryEntry {
  const complete: SinkHistoryEntry = {
    ...entry,
    correlationId: entry.correlationId ?? null,
    receivedAt: new Date(nowMs).toISOString(),
    requestId: randomUUID(),
  };
  appendBounded(state.history, complete, MAX_HISTORY_ENTRIES);
  return complete;
}

function rememberEvent(
  state: MutableSinkState,
  eventId: string,
  digest: Buffer,
  acceptedAt: string,
): void {
  if (state.received.size >= MAX_DEDUPE_ENTRIES) {
    const oldest = state.received.keys().next().value;
    if (oldest !== undefined) {
      state.received.delete(oldest);
    }
  }
  state.received.set(eventId, { digest, firstAcceptedAt: acceptedAt });
}

async function handleWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  options: SinkOptions,
  state: MutableSinkState,
): Promise<void> {
  const nowMs = (options.now ?? Date.now)();
  const contentType = header(request, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    sendJson(response, 415, { error: { code: 'CONTENT_TYPE_UNSUPPORTED' } });
    return;
  }
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request, options.maxBodyBytes ?? SINK_MAX_BODY_BYTES);
  } catch (error) {
    const statusCode = error instanceof PayloadTooLargeError ? 413 : 400;
    sendJson(response, statusCode, {
      error: { code: statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_BODY' },
    });
    return;
  }

  const eventId = header(request, OUTBOUND_WEBHOOK_HEADERS.eventId);
  const keyId = header(request, OUTBOUND_WEBHOOK_HEADERS.keyId);
  const signature = header(request, OUTBOUND_WEBHOOK_HEADERS.signature);
  const timestamp = parsePositiveInteger(header(request, OUTBOUND_WEBHOOK_HEADERS.timestamp));
  const attempt = parsePositiveInteger(header(request, OUTBOUND_WEBHOOK_HEADERS.attempt));

  if (
    eventId === undefined ||
    keyId !== options.keyId ||
    signature === undefined ||
    timestamp === undefined ||
    attempt === undefined ||
    attempt > 1_000
  ) {
    recordHistory(
      state,
      {
        accepted: false,
        attempt: attempt ?? null,
        duplicate: false,
        eventId: eventId ?? null,
        eventType: null,
        statusCode: 401,
      },
      nowMs,
    );
    sendJson(response, 401, { error: { code: 'WEBHOOK_SIGNATURE_INVALID' } });
    return;
  }

  const nowSeconds = Math.floor(nowMs / 1_000);
  if (Math.abs(nowSeconds - timestamp) > options.clockSkewSeconds) {
    recordHistory(
      state,
      { accepted: false, attempt, duplicate: false, eventId, eventType: null, statusCode: 401 },
      nowMs,
    );
    sendJson(response, 401, { error: { code: 'WEBHOOK_TIMESTAMP_INVALID' } });
    return;
  }

  if (
    !verifyOutboundSignature(signature, {
      attempt,
      eventId,
      rawBody,
      secret: options.secret,
      timestamp,
    })
  ) {
    recordHistory(
      state,
      { accepted: false, attempt, duplicate: false, eventId, eventType: null, statusCode: 401 },
      nowMs,
    );
    sendJson(response, 401, { error: { code: 'WEBHOOK_SIGNATURE_INVALID' } });
    return;
  }

  let event: EventEnvelope;
  try {
    event = EventEnvelopeSchema.parse(JSON.parse(rawBody.toString('utf8')));
  } catch {
    recordHistory(
      state,
      { accepted: false, attempt, duplicate: false, eventId, eventType: null, statusCode: 400 },
      nowMs,
    );
    sendJson(response, 400, { error: { code: 'VALIDATION_FAILED' } });
    return;
  }

  if (event.eventId !== eventId) {
    recordHistory(
      state,
      {
        accepted: false,
        attempt,
        correlationId: event.correlationId,
        duplicate: false,
        eventId,
        eventType: event.eventType,
        statusCode: 409,
      },
      nowMs,
    );
    sendJson(response, 409, { error: { code: 'EVENT_ID_MISMATCH' } });
    return;
  }

  if (state.failure.failNext > 0) {
    state.failure.failNext -= 1;
    if (state.failure.delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, state.failure.delayMs));
    }
    const injectedStatus = state.failure.statusCode;
    recordHistory(
      state,
      {
        accepted: false,
        attempt,
        correlationId: event.correlationId,
        duplicate: false,
        eventId,
        eventType: event.eventType,
        statusCode: injectedStatus,
      },
      nowMs,
    );
    sendJson(response, injectedStatus, {
      error: { code: 'INJECTED_FAILURE', remaining: state.failure.failNext },
    });
    return;
  }

  const digest = createHash('sha256').update(rawBody).digest();
  const existing = state.received.get(eventId);
  if (existing !== undefined) {
    const samePayload =
      existing.digest.length === digest.length && timingSafeEqual(existing.digest, digest);
    const statusCode = samePayload ? 200 : 409;
    const history = recordHistory(
      state,
      {
        accepted: samePayload,
        attempt,
        correlationId: event.correlationId,
        duplicate: samePayload,
        eventId,
        eventType: event.eventType,
        statusCode,
      },
      nowMs,
    );
    sendJson(
      response,
      statusCode,
      samePayload
        ? { accepted: true, duplicate: true, eventId, requestId: history.requestId }
        : { error: { code: 'EVENT_ID_COLLISION' } },
    );
    return;
  }

  const history = recordHistory(
    state,
    {
      accepted: true,
      attempt,
      correlationId: event.correlationId,
      duplicate: false,
      eventId,
      eventType: event.eventType,
      statusCode: 202,
    },
    nowMs,
  );
  rememberEvent(state, eventId, digest, history.receivedAt);
  sendJson(response, 202, {
    accepted: true,
    duplicate: false,
    eventId,
    requestId: history.requestId,
  });
}

export interface WebhookSinkServer {
  readonly server: Server;
  close(): Promise<void>;
  listen(): Promise<number>;
  reset(): void;
  snapshot(): readonly SinkHistoryEntry[];
}

export function createWebhookSinkServer(options: SinkOptions): WebhookSinkServer {
  if (isIP(options.host) !== 4) {
    throw new Error('Webhook sink host must be an explicit IPv4 address');
  }

  const state: MutableSinkState = {
    failure: { delayMs: 0, failNext: 0, statusCode: 503 },
    history: [],
    received: new Map(),
  };

  const reset = (): void => {
    state.failure = { delayMs: 0, failNext: 0, statusCode: 503 };
    state.history.length = 0;
    state.received.clear();
  };

  const server = createServer((request, response) => {
    void (async () => {
      const method = request.method ?? 'GET';
      const path = parsePath(request);

      if (method === 'GET' && path === '/health') {
        sendJson(response, 200, {
          service: 'queueforge-webhook-sink',
          status: 'ok',
          timestamp: new Date((options.now ?? Date.now)()).toISOString(),
          version: '0.1.0',
        });
        return;
      }
      if (method === 'GET' && path === '/history') {
        sendJson(response, 200, { entries: state.history, total: state.history.length });
        return;
      }
      if (method === 'POST' && path === '/webhooks') {
        await handleWebhook(request, response, options, state);
        return;
      }
      if (method === 'POST' && path === '/controls/failures') {
        if (!controlAllowed(request, options)) {
          sendJson(response, 403, { error: { code: 'CONTROL_FORBIDDEN' } });
          return;
        }
        try {
          state.failure = FailureControlSchema.parse(
            JSON.parse((await readRawBody(request, 4_096)).toString('utf8')),
          );
          sendJson(response, 200, state.failure);
        } catch (error) {
          sendJson(response, error instanceof PayloadTooLargeError ? 413 : 400, {
            error: { code: 'VALIDATION_FAILED' },
          });
        }
        return;
      }
      if (method === 'POST' && path === '/reset') {
        if (!controlAllowed(request, options)) {
          sendJson(response, 403, { error: { code: 'CONTROL_FORBIDDEN' } });
          return;
        }
        reset();
        sendJson(response, 200, { reset: true });
        return;
      }

      sendJson(response, 404, { error: { code: 'NOT_FOUND' } });
    })().catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: { code: 'INTERNAL_ERROR' } });
      } else {
        response.destroy();
      }
    });
  });

  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
    listen: () =>
      new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, () => {
          server.off('error', reject);
          const address = server.address();
          resolve(typeof address === 'object' && address !== null ? address.port : options.port);
        });
      }),
    reset,
    snapshot: () => Object.freeze([...state.history]),
  };
}

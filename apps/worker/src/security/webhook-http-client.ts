import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { CORRELATION_HEADER, OUTBOUND_WEBHOOK_HEADERS } from '@queueforge/contracts';

import {
  RetryableDeliveryError,
  TerminalDeliveryError,
  safeErrorCode,
  safeErrorMessage,
} from '../core/errors.js';
import { resolveWebhookTarget, type HostResolver, type TargetPolicy } from './target-policy.js';
import { signWebhook } from './webhook-signing.js';

const MAX_RESPONSE_BYTES = 65_536;
const MAX_RESPONSE_EXCERPT_LENGTH = 1_000;

export interface WebhookHttpDeliveryInput {
  readonly attempt: number;
  readonly correlationId: string;
  readonly eventId: string;
  readonly keyId: string;
  readonly now?: () => number;
  readonly policy: TargetPolicy;
  readonly rawBody: Buffer;
  readonly resolver?: HostResolver;
  readonly secret: string;
  readonly signal?: AbortSignal;
  readonly targetUrl: string;
  readonly timeoutMs: number;
}

export interface WebhookHttpDeliveryResult {
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly outcome: 'delivered' | 'retryable_failure' | 'terminal_failure';
  readonly responseBodyExcerpt: string | null;
  readonly statusCode: number | null;
}

function responseExcerpt(value: Buffer): string | null {
  if (value.length === 0) {
    return null;
  }
  const printable = [...value.toString('utf8')]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint === 9 ||
        codePoint === 10 ||
        codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127)
      );
    })
    .join('');
  return printable.slice(0, MAX_RESPONSE_EXCERPT_LENGTH);
}

function isRetryableStatus(statusCode: number): boolean {
  return (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  );
}

async function performPinnedRequest(
  input: WebhookHttpDeliveryInput,
  target: Awaited<ReturnType<typeof resolveWebhookTarget>>,
  timestamp: number,
): Promise<{ readonly body: Buffer; readonly statusCode: number }> {
  const signature = signWebhook({
    attempt: input.attempt,
    eventId: input.eventId,
    rawBody: input.rawBody,
    secret: input.secret,
    timestamp,
  });
  const options: RequestOptions = {
    agent: false,
    family: target.family,
    headers: {
      'content-length': input.rawBody.length,
      'content-type': 'application/json',
      [CORRELATION_HEADER]: input.correlationId,
      host: target.hostHeader,
      [OUTBOUND_WEBHOOK_HEADERS.attempt]: String(input.attempt),
      [OUTBOUND_WEBHOOK_HEADERS.eventId]: input.eventId,
      [OUTBOUND_WEBHOOK_HEADERS.keyId]: input.keyId,
      [OUTBOUND_WEBHOOK_HEADERS.signature]: signature,
      [OUTBOUND_WEBHOOK_HEADERS.timestamp]: String(timestamp),
      'user-agent': 'QueueForge-Worker/0.1',
    },
    hostname: target.address,
    joinDuplicateHeaders: false,
    method: 'POST',
    path: `${target.url.pathname}${target.url.search}`,
    port:
      target.url.port === ''
        ? target.url.protocol === 'https:'
          ? 443
          : 80
        : Number(target.url.port),
    protocol: target.url.protocol,
    setHost: false,
    signal: input.signal,
  };
  if (target.url.protocol === 'https:') {
    Object.assign(options, {
      rejectUnauthorized: true,
      servername: target.originalHostname,
    });
  }

  return new Promise((resolve, reject) => {
    const send = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(options, (response) => {
      const chunks: Buffer[] = [];
      let length = 0;
      let exceeded = false;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += buffer.length;
        if (length > MAX_RESPONSE_BYTES) {
          exceeded = true;
          chunks.length = 0;
          response.destroy(new Error('Webhook response exceeded the size limit'));
          return;
        }
        chunks.push(buffer);
      });
      response.once('error', reject);
      response.once('end', () => {
        if (exceeded) {
          reject(
            new RetryableDeliveryError(
              'Webhook response exceeded the size limit',
              'WEBHOOK_RESPONSE_TOO_LARGE',
            ),
          );
          return;
        }
        resolve({ body: Buffer.concat(chunks, length), statusCode: response.statusCode ?? 502 });
      });
    });
    request.setTimeout(input.timeoutMs, () => {
      request.destroy(new RetryableDeliveryError('Webhook request timed out', 'WEBHOOK_TIMEOUT'));
    });
    request.once('error', reject);
    request.end(input.rawBody);
  });
}

export async function deliverWebhookHttp(
  input: WebhookHttpDeliveryInput,
): Promise<WebhookHttpDeliveryResult> {
  const startedAt = (input.now ?? Date.now)();
  try {
    const target = await resolveWebhookTarget(input.targetUrl, input.policy, input.resolver);
    const timestamp = Math.floor((input.now ?? Date.now)() / 1_000);
    const response = await performPinnedRequest(input, target, timestamp);
    const durationMs = Math.max(0, (input.now ?? Date.now)() - startedAt);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return {
        durationMs,
        errorCode: null,
        errorMessage: null,
        outcome: 'delivered',
        responseBodyExcerpt: responseExcerpt(response.body),
        statusCode: response.statusCode,
      };
    }
    if (response.statusCode >= 300 && response.statusCode < 400) {
      return {
        durationMs,
        errorCode: 'WEBHOOK_REDIRECT_BLOCKED',
        errorMessage: 'Webhook redirects are disabled',
        outcome: 'terminal_failure',
        responseBodyExcerpt: responseExcerpt(response.body),
        statusCode: response.statusCode,
      };
    }
    const retryable = isRetryableStatus(response.statusCode);
    return {
      durationMs,
      errorCode: retryable ? 'WEBHOOK_RETRYABLE_STATUS' : 'WEBHOOK_TERMINAL_STATUS',
      errorMessage: `Webhook target returned HTTP ${response.statusCode}`,
      outcome: retryable ? 'retryable_failure' : 'terminal_failure',
      responseBodyExcerpt: responseExcerpt(response.body),
      statusCode: response.statusCode,
    };
  } catch (error) {
    const terminal = error instanceof TerminalDeliveryError;
    return {
      durationMs: Math.max(0, (input.now ?? Date.now)() - startedAt),
      errorCode: safeErrorCode(error),
      errorMessage: safeErrorMessage(error),
      outcome: terminal ? 'terminal_failure' : 'retryable_failure',
      responseBodyExcerpt: null,
      statusCode: null,
    };
  }
}

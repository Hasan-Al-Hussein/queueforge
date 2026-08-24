import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { RuntimeEnvironment } from '@queueforge/config';
import {
  SubmitWorkflowRequestSchema,
  type TenantContext,
  type WebhookReceipt,
} from '@queueforge/contracts';
import { createIdempotencyFingerprint, hashJson, sha256Hex } from '@queueforge/domain';
import { RequestSubmissionStore, WebhookSecretStore } from '@queueforge/persistence';

import { RUNTIME_ENVIRONMENT } from './configuration.js';
import { ApplicationError } from './errors.js';

const MAX_INBOUND_BODY_BYTES = 1_048_576;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface InboundWebhookHeaders {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly keyId: string;
  readonly nonce: string;
  readonly signature: string;
  readonly timestamp: string;
}

function decodeSignature(value: string): Buffer | null {
  const normalized = value.startsWith('sha256=') ? value.slice(7) : value;
  return /^[0-9a-f]{64}$/i.test(normalized) ? Buffer.from(normalized, 'hex') : null;
}

@Injectable()
export class InboundWebhookService {
  public constructor(
    private readonly secrets: WebhookSecretStore,
    private readonly submissions: RequestSubmissionStore,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public async accept(
    tenantSlug: string,
    endpointId: string,
    rawBody: Buffer,
    headers: InboundWebhookHeaders,
    correlationId: string,
  ): Promise<WebhookReceipt> {
    if (
      rawBody.length === 0 ||
      rawBody.length > MAX_INBOUND_BODY_BYTES ||
      !UUID_PATTERN.test(endpointId) ||
      !UUID_PATTERN.test(headers.eventId) ||
      headers.nonce.length < 16 ||
      headers.nonce.length > 200 ||
      headers.idempotencyKey.length < 8 ||
      headers.idempotencyKey.length > 200
    ) {
      throw new ApplicationError('VALIDATION_FAILED', 'Inbound webhook metadata is invalid');
    }
    const timestampSeconds = Number(headers.timestamp);
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      !Number.isSafeInteger(timestampSeconds) ||
      Math.abs(nowSeconds - timestampSeconds) > this.environment.WEBHOOK_CLOCK_SKEW_SECONDS
    ) {
      throw new ApplicationError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid');
    }
    const client = await this.secrets.findInboundClient(
      tenantSlug,
      endpointId,
      headers.keyId,
      this.environment.WEBHOOK_MASTER_KEY,
    );
    const supplied = decodeSignature(headers.signature);
    if (client === null || supplied === null) {
      throw new ApplicationError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid');
    }
    const expected = createHmac('sha256', client.signingSecret)
      .update(
        Buffer.from(
          `${headers.timestamp}.${headers.nonce}.${headers.eventId}.${headers.idempotencyKey}.${headers.keyId}.`,
          'utf8',
        ),
      )
      .update(rawBody)
      .digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ApplicationError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new ApplicationError('VALIDATION_FAILED', 'Webhook body must be valid JSON');
    }
    const command = SubmitWorkflowRequestSchema.safeParse(parsed);
    if (!command.success) {
      throw new ApplicationError('VALIDATION_FAILED', 'Webhook body is invalid', {
        issueCount: command.error.issues.length,
      });
    }
    const context: TenantContext = {
      tenantId: client.tenantId,
      principalId: client.endpointId,
      principalKind: 'api_client',
      role: 'operator',
    };
    return this.submissions.submitInboundWebhook({
      context,
      workflowKey: command.data.workflowKey,
      payload: command.data.payload,
      payloadHash: hashJson(command.data.payload),
      source: 'inbound_webhook',
      correlationId,
      endpointScope: `inbound-webhook:${client.endpointId}`,
      idempotencyKeyHash: sha256Hex(headers.idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'inbound-webhook.submit',
        principalId: client.endpointId,
        request: command.data,
      }),
      endpointId: client.endpointId,
      externalEventId: headers.eventId,
      nonce: headers.nonce,
      nonceExpiresAt: new Date(
        (timestampSeconds + this.environment.WEBHOOK_CLOCK_SKEW_SECONDS + 1) * 1_000,
      ),
      signatureKeyId: headers.keyId,
    });
  }
}

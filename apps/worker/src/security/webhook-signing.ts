import { createHmac } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

export interface WebhookSignatureInput {
  readonly attempt: number;
  readonly eventId: string;
  readonly rawBody: Buffer;
  readonly secret: string;
  readonly timestamp: number;
}

export function webhookSignaturePayload(
  input: Pick<WebhookSignatureInput, 'attempt' | 'eventId' | 'rawBody' | 'timestamp'>,
): Buffer {
  return Buffer.concat([
    Buffer.from(`${input.eventId}.${input.timestamp}.${input.attempt}.`, 'utf8'),
    input.rawBody,
  ]);
}

export function signWebhook(input: WebhookSignatureInput): string {
  const digest = createHmac('sha256', input.secret)
    .update(webhookSignaturePayload(input))
    .digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';
const SHA256_HEX_LENGTH = 64;

export interface OutboundSignatureInput {
  readonly attempt: number;
  readonly eventId: string;
  readonly rawBody: Buffer;
  readonly secret: string;
  readonly timestamp: number;
}

export function outboundSignaturePayload(
  input: Pick<OutboundSignatureInput, 'attempt' | 'eventId' | 'rawBody' | 'timestamp'>,
): Buffer {
  const prefix = Buffer.from(`${input.eventId}.${input.timestamp}.${input.attempt}.`, 'utf8');
  return Buffer.concat([prefix, input.rawBody]);
}

export function createOutboundSignature(input: OutboundSignatureInput): string {
  const digest = createHmac('sha256', input.secret)
    .update(outboundSignaturePayload(input))
    .digest('hex');
  return `${SIGNATURE_PREFIX}${digest}`;
}

export function verifyOutboundSignature(signature: string, input: OutboundSignatureInput): boolean {
  if (
    !signature.startsWith(SIGNATURE_PREFIX) ||
    signature.length !== SIGNATURE_PREFIX.length + SHA256_HEX_LENGTH
  ) {
    return false;
  }

  const suppliedHex = signature.slice(SIGNATURE_PREFIX.length);
  if (!/^[a-f0-9]{64}$/i.test(suppliedHex)) {
    return false;
  }

  const supplied = Buffer.from(suppliedHex, 'hex');
  const expected = Buffer.from(
    createOutboundSignature(input).slice(SIGNATURE_PREFIX.length),
    'hex',
  );
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

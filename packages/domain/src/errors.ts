export type DomainErrorCode =
  | 'INVALID_STATE_TRANSITION'
  | 'INVALID_RETRY_POLICY'
  | 'INVALID_JSON_VALUE'
  | 'PAYLOAD_SCHEMA_INVALID';

export class DomainError extends Error {
  public constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

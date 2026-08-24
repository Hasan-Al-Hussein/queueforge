import type { ErrorCode } from '@queueforge/contracts';

export class ApplicationError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

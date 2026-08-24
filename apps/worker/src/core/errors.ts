const MAX_SAFE_ERROR_LENGTH = 500;

export class TerminalDeliveryError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'TerminalDeliveryError';
  }
}

export class RetryableDeliveryError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'RetryableDeliveryError';
  }
}

export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : 'Unknown worker error';
  return raw.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_SAFE_ERROR_LENGTH);
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof TerminalDeliveryError || error instanceof RetryableDeliveryError) {
    return error.code;
  }
  if (error instanceof Error && error.name === 'WorkerTimeoutError') {
    return 'WORKER_TIMEOUT';
  }
  return 'WORKER_FAILED';
}

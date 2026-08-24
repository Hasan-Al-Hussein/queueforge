export class WorkerTimeoutError extends Error {
  public constructor(public readonly timeoutMs: number) {
    super(`Worker operation exceeded ${timeoutMs}ms`);
    this.name = 'WorkerTimeoutError';
  }
}

export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('Timeout must be a positive integer');
  }

  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new WorkerTimeoutError(timeoutMs));
    }, timeoutMs);
    timeoutHandle.unref();
  });

  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

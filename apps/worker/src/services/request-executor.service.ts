import { Injectable } from '@nestjs/common';
import {
  ProcessorTargetConfigSchema,
  WorkflowProcessingConfigSchema,
  type EventEnvelope,
  type JsonObject,
} from '@queueforge/contracts';
import { z } from 'zod';

const RequestJobPayloadSchema = z.object({ requestId: z.string().uuid() }).passthrough();

export interface RequestExecutionContext {
  readonly attemptNo: number;
  readonly event: EventEnvelope;
  readonly processingConfig: JsonObject;
  readonly processorConfig: JsonObject;
  readonly reportProgress: (progress: number) => Promise<void>;
  readonly signal: AbortSignal;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds === 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = (): void => {
      clearTimeout(handle);
      reject(new Error('Request execution was aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });
}

@Injectable()
export class RequestExecutorService {
  public parseRequestId(event: EventEnvelope): string {
    return RequestJobPayloadSchema.parse(event.payload).requestId;
  }

  public async execute(context: RequestExecutionContext): Promise<void> {
    ProcessorTargetConfigSchema.parse(context.processorConfig);
    const configuration = WorkflowProcessingConfigSchema.parse(context.processingConfig);
    const stageDelay = Math.floor(configuration.durationMs / 3);

    await context.reportProgress(10);
    await abortableDelay(stageDelay, context.signal);
    await context.reportProgress(45);
    await abortableDelay(stageDelay, context.signal);
    if (context.attemptNo <= configuration.failuresBeforeSuccess) {
      throw new Error('Injected local workflow failure');
    }
    await context.reportProgress(80);
    await abortableDelay(configuration.durationMs - stageDelay * 2, context.signal);
    await context.reportProgress(100);
  }
}

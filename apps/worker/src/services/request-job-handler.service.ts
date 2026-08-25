import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { ProcessedEventStore, RequestExecutionStore } from '@queueforge/persistence';

import { RetryableDeliveryError, safeErrorCode, safeErrorMessage } from '../core/errors.js';
import { parseEventEnvelope } from '../core/jobs.js';
import { WORKER_CONFIGURATION, WORKER_ID, type WorkerConfiguration } from '../core/ports.js';
import { runWithTimeout } from '../core/timeout.js';
import { RequestExecutorService } from './request-executor.service.js';

const REQUEST_CONSUMER = 'queueforge.request-executor.v1';

@Injectable()
export class RequestJobHandlerService {
  private readonly logger = new Logger(RequestJobHandlerService.name);

  public constructor(
    private readonly processedEvents: ProcessedEventStore,
    private readonly requests: RequestExecutionStore,
    private readonly executor: RequestExecutorService,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
    @Inject(WORKER_ID) private readonly workerId: string,
  ) {}

  public async handle(job: Job): Promise<void> {
    const event = parseEventEnvelope(job.data);
    if (await this.processedEvents.has(event.tenantId, REQUEST_CONSUMER, event.eventId)) {
      return;
    }

    const scope = { tenantId: event.tenantId };
    const requestId = this.executor.parseRequestId(event);
    const recoveryThresholdMs = Math.max(30_000, this.configuration.requestTimeoutMs + 5_000);
    const attempt = await this.requests.beginOrRecoverAttempt(
      scope,
      requestId,
      this.workerId,
      new Date(Date.now() - recoveryThresholdMs),
      { consumer: REQUEST_CONSUMER, eventId: event.eventId },
    );
    if ('duplicate' in attempt) {
      return;
    }
    if ('deadLettered' in attempt) {
      this.logger.error(
        { eventId: event.eventId, requestId, tenantId: event.tenantId },
        'Interrupted request exhausted its attempts and moved to the dead-letter queue',
      );
      return;
    }
    try {
      await runWithTimeout(
        (signal) =>
          this.executor.execute({
            attemptNo: attempt.budgetAttemptNo,
            event,
            processingConfig: attempt.processingConfig,
            processorConfig: attempt.processorConfig,
            reportProgress: async (progress) => {
              try {
                await job.updateProgress(progress);
              } catch (error) {
                this.logger.warn(
                  {
                    errorCode: safeErrorCode(error),
                    eventId: event.eventId,
                    requestId,
                    tenantId: event.tenantId,
                  },
                  'Request progress update failed; execution remains authoritative',
                );
              }
            },
            signal,
          }),
        this.configuration.requestTimeoutMs,
      );
    } catch (error) {
      const finalStatus = await this.requests.completeFailedOnce(
        scope,
        event.eventId,
        REQUEST_CONSUMER,
        {
          attemptNo: attempt.attemptNo,
          correlationId: attempt.correlationId,
          errorCode: safeErrorCode(error),
          errorMessage: safeErrorMessage(error),
          requestId,
          startedAt: attempt.startedAt,
          workerId: this.workerId,
        },
      );
      if (finalStatus === 'duplicate') {
        return;
      }
      if (finalStatus === 'dead_lettered') {
        this.logger.error(
          { eventId: event.eventId, requestId, tenantId: event.tenantId },
          'Request moved to the dead-letter queue',
        );
        return;
      }
      throw new RetryableDeliveryError(
        'Request execution will be retried',
        'REQUEST_RETRY_SCHEDULED',
      );
    }
    await this.requests.completeSucceededOnce(scope, event.eventId, REQUEST_CONSUMER, {
      attemptNo: attempt.attemptNo,
      correlationId: attempt.correlationId,
      requestId,
      startedAt: attempt.startedAt,
      workerId: this.workerId,
    });
  }
}

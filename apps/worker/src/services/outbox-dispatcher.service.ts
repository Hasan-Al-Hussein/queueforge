import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_SCHEMA_VERSION, QUEUE_NAMES, type EventEnvelope } from '@queueforge/contracts';

import { boundedExponentialBackoff } from '../core/backoff.js';
import { safeErrorMessage } from '../core/errors.js';
import { deterministicJobId, queueForEvent } from '../core/jobs.js';
import {
  OUTBOX_STORE,
  QUEUE_PUBLISHER,
  WORKER_CONFIGURATION,
  WORKER_ID,
  type ClaimedOutboxEvent,
  type OutboxStorePort,
  type QueuePublisherPort,
  type WorkerConfiguration,
} from '../core/ports.js';

const OUTBOX_BATCH_SIZE = 25;
const OUTBOX_RECOVERY_BATCH_SIZE = 100;
const OUTBOX_RECOVERY_BATCH_LIMIT = 10;
const DELIVERY_JOB_ATTEMPTS = 10;
// BullMQ only gates transport retries. The request row's immutable max_attempts
// remains authoritative and terminates execution earlier when configured below 25.
const REQUEST_JOB_ATTEMPT_CEILING = 25;
const BULLMQ_BACKOFF_TYPE = 'queueforge-bounded';

function toEnvelope(record: ClaimedOutboxEvent): EventEnvelope {
  if (record.schemaVersion !== EVENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported event schema version ${record.schemaVersion}`);
  }
  return {
    aggregateId: record.aggregateId,
    aggregateType: record.aggregateType,
    correlationId: record.correlationId,
    eventId: record.id,
    eventType: record.eventType,
    occurredAt: record.occurredAt.toISOString(),
    payload: record.payload,
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: record.tenantId,
  };
}

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private active = false;
  private dispatchPromise: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;

  public constructor(
    @Inject(OUTBOX_STORE) private readonly outbox: OutboxStorePort,
    @Inject(QUEUE_PUBLISHER) private readonly publisher: QueuePublisherPort,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
    @Inject(WORKER_ID) private readonly ownerId: string,
  ) {}

  public async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    await this.dispatchOnce();
    this.schedule();
  }

  public async stop(reason = 'worker shutdown'): Promise<number> {
    this.active = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    let dispatchFailure: unknown;
    try {
      await this.dispatchPromise;
    } catch (error) {
      dispatchFailure = error;
    }

    let released = 0;
    try {
      released = await this.outbox.releaseOwnerLeases(this.ownerId, reason);
    } catch (releaseFailure) {
      if (dispatchFailure !== undefined) {
        throw new AggregateError(
          [dispatchFailure, releaseFailure],
          'Outbox dispatch failed and owned leases could not be released',
        );
      }
      throw releaseFailure;
    }
    if (dispatchFailure !== undefined) {
      throw dispatchFailure instanceof Error
        ? dispatchFailure
        : new Error('Outbox dispatch failed', { cause: dispatchFailure });
    }
    return released;
  }

  public async dispatchOnce(): Promise<void> {
    if (this.dispatchPromise !== undefined) {
      return this.dispatchPromise;
    }
    const operation = this.dispatchBatch().finally(() => {
      this.dispatchPromise = undefined;
    });
    this.dispatchPromise = operation;
    return operation;
  }

  private schedule(): void {
    if (!this.active) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.dispatchOnce()
        .catch((error: unknown) => {
          this.logger.error({ error: safeErrorMessage(error) }, 'Outbox polling failed');
        })
        .finally(() => this.schedule());
    }, this.configuration.outboxPollIntervalMs);
    this.timer.unref();
  }

  private async dispatchBatch(): Promise<void> {
    let recoveredTotal = 0;
    let recovered: number;
    let recoveryBatches = 0;
    do {
      recovered = await this.outbox.recoverExpiredLeases(OUTBOX_RECOVERY_BATCH_SIZE);
      recoveredTotal += recovered;
      recoveryBatches += 1;
    } while (
      recovered === OUTBOX_RECOVERY_BATCH_SIZE &&
      recoveryBatches < OUTBOX_RECOVERY_BATCH_LIMIT
    );
    if (recoveredTotal > 0) {
      this.logger.warn({ recovered: recoveredTotal }, 'Recovered expired outbox leases');
    }
    const records = await this.outbox.claimBatch(
      this.ownerId,
      this.configuration.leaseSeconds,
      OUTBOX_BATCH_SIZE,
    );
    await Promise.all(records.map((record) => this.dispatchRecord(record)));
  }

  private async dispatchRecord(record: ClaimedOutboxEvent): Promise<void> {
    try {
      const envelope = toEnvelope(record);
      const queueName = queueForEvent(record.eventType);
      if (queueName !== undefined) {
        await this.publisher.publish(queueName, envelope, {
          attempts:
            queueName === QUEUE_NAMES.requests
              ? REQUEST_JOB_ATTEMPT_CEILING
              : DELIVERY_JOB_ATTEMPTS,
          backoffType: BULLMQ_BACKOFF_TYPE,
          jobId: deterministicJobId(record.id),
        });
      } else {
        this.logger.debug(
          { eventId: record.id, eventType: record.eventType },
          'Acknowledging observational outbox event with no internal queue consumer',
        );
      }
      const published = await this.outbox.markPublished(
        record.tenantId,
        record.id,
        record.leaseOwner,
      );
      if (!published) {
        this.logger.warn(
          { eventId: record.id, tenantId: record.tenantId },
          'Outbox publish acknowledgement lost its lease',
        );
      }
    } catch (error) {
      const retryDelay = boundedExponentialBackoff(record.attemptCount);
      await this.outbox.markFailed(
        record.tenantId,
        record.id,
        record.leaseOwner,
        safeErrorMessage(error),
        new Date(Date.now() + retryDelay),
      );
    }
  }
}

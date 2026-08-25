import { Inject, Injectable, Logger } from '@nestjs/common';
import { DelayedError, Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';

import { QUEUE_NAMES, type EventEnvelope } from '@queueforge/contracts';

import { boundedExponentialBackoff } from '../core/backoff.js';
import { safeErrorCode, safeErrorMessage } from '../core/errors.js';
import type { QueueName } from '../core/jobs.js';
import {
  WORKER_CONFIGURATION,
  WORKER_ID,
  type QueuePublishOptions,
  type QueuePublisherPort,
  type QueueTelemetrySnapshot,
  type WorkerConfiguration,
  type WorkerStatusSnapshot,
  type WorkerTelemetrySnapshot,
} from '../core/ports.js';
import { NotificationJobHandlerService } from './notification-job-handler.service.js';
import { RequestJobHandlerService } from './request-job-handler.service.js';
import { WebhookJobHandlerService } from './webhook-job-handler.service.js';

const RETAIN_COMPLETED_SECONDS = 86_400;
const RETAIN_FAILED_SECONDS = 604_800;
const RETAIN_JOB_COUNT = 1_000;
const STALLED_RECOVERY_CHECK_INTERVAL_MS = 5_000;
// QueueForge's database leases and state machines are the terminal authorities.
// A Bull stalled job must therefore remain recoverable instead of exhausting a
// small transport-only crash counter and stranding a processing database row.
const DURABLE_STALL_RECOVERY_LIMIT = Number.MAX_SAFE_INTEGER;

function connectionOptions(
  redisUrl: string,
  maxRetriesPerRequest: number | null,
): ConnectionOptions {
  return {
    connectTimeout: 5_000,
    enableReadyCheck: true,
    maxRetriesPerRequest,
    url: redisUrl,
  };
}

@Injectable()
export class QueueRuntimeService implements QueuePublisherPort {
  private readonly logger = new Logger(QueueRuntimeService.name);
  private readonly queues = new Map<QueueName, Queue<EventEnvelope>>();
  private readonly workers: Worker<EventEnvelope>[] = [];
  private activeJobs = 0;
  private state: WorkerStatusSnapshot['state'] = 'stopped';

  public constructor(
    private readonly requestHandler: RequestJobHandlerService,
    private readonly webhookHandler: WebhookJobHandlerService,
    private readonly notificationHandler: NotificationJobHandlerService,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
    @Inject(WORKER_ID) private readonly workerId: string,
  ) {}

  public async start(): Promise<void> {
    if (this.state !== 'stopped') {
      return;
    }
    this.state = 'running';
    const producerConnection = {
      ...connectionOptions(this.configuration.redisUrl, 1),
      enableOfflineQueue: false,
    };
    const workerConnection = connectionOptions(this.configuration.redisUrl, null);
    try {
      for (const queueName of Object.values(QUEUE_NAMES)) {
        const queue = new Queue<EventEnvelope>(queueName, {
          connection: producerConnection,
          prefix: 'queueforge',
        });
        this.queues.set(queueName, queue);
      }

      const processors: ReadonlyArray<
        readonly [QueueName, (job: Job<EventEnvelope>) => Promise<void>]
      > = [
        [QUEUE_NAMES.requests, (job) => this.requestHandler.handle(job)],
        [QUEUE_NAMES.webhooks, (job) => this.webhookHandler.handle(job)],
        [QUEUE_NAMES.notifications, (job) => this.notificationHandler.handle(job)],
      ];
      for (const [queueName, processor] of processors) {
        const worker = new Worker<EventEnvelope>(
          queueName,
          async (job, token) => {
            this.activeJobs += 1;
            try {
              try {
                await processor(job);
              } catch (error) {
                const retryDelay = boundedExponentialBackoff(Math.max(1, job.attemptsStarted));
                this.logger.warn(
                  {
                    errorCode: safeErrorCode(error),
                    jobId: job.id,
                    queue: queueName,
                    retryDelay,
                    starts: job.attemptsStarted,
                  },
                  'Deferring queue job without consuming its finite transport-attempt fallback',
                );
                await job.moveToDelayed(Date.now() + retryDelay, token);
                throw new DelayedError();
              }
            } finally {
              this.activeJobs -= 1;
            }
          },
          {
            concurrency: this.configuration.concurrency,
            connection: workerConnection,
            lockDuration: Math.max(
              30_000,
              this.configuration.requestTimeoutMs + 5_000,
              this.configuration.webhookTimeoutMs + 5_000,
            ),
            maxStalledCount: DURABLE_STALL_RECOVERY_LIMIT,
            // BullMQ first marks an active job as a stall candidate and only moves it
            // after a later scan observes an expired lock. Keep that second scan well
            // inside the lock-duration window so a boundary race cannot add 30 seconds.
            stalledInterval: STALLED_RECOVERY_CHECK_INTERVAL_MS,
            name: this.workerId,
            prefix: 'queueforge',
            removeOnComplete: {
              age: RETAIN_COMPLETED_SECONDS,
              count: RETAIN_JOB_COUNT,
            },
            removeOnFail: {
              age: RETAIN_FAILED_SECONDS,
              count: RETAIN_JOB_COUNT,
            },
            settings: {
              backoffStrategy: (attemptsMade, type) => {
                if (type !== 'queueforge-bounded') {
                  throw new Error(`Unsupported BullMQ backoff strategy: ${type ?? 'missing'}`);
                }
                return boundedExponentialBackoff(attemptsMade);
              },
            },
          },
        );
        worker.on('failed', (job, error) => {
          this.logger.warn(
            {
              attempt: job?.attemptsMade,
              errorCode: safeErrorCode(error),
              jobId: job?.id,
              queue: queueName,
            },
            'Queue job attempt failed',
          );
        });
        worker.on('stalled', (jobId) => {
          this.logger.warn(
            { jobId, queue: queueName },
            'Queue job was recovered from a stalled worker',
          );
        });
        worker.on('error', (error) => {
          this.logger.error(
            { error: safeErrorMessage(error), queue: queueName },
            'BullMQ worker error',
          );
        });
        this.workers.push(worker);
      }

      await Promise.all([
        ...[...this.queues.values()].map((queue) => queue.waitUntilReady()),
        ...this.workers.map((worker) => worker.waitUntilReady()),
      ]);
    } catch (error) {
      await this.drain().catch(() => undefined);
      throw error;
    }
  }

  public async publish(
    queueName: QueueName,
    event: EventEnvelope,
    options: QueuePublishOptions,
  ): Promise<void> {
    const queue = this.queues.get(queueName);
    if (this.state !== 'running' || queue === undefined) {
      throw new Error('Queue runtime is not accepting new jobs');
    }
    await queue.add(event.eventType, event, {
      attempts: options.attempts,
      backoff: { type: options.backoffType },
      jobId: options.jobId,
      removeOnComplete: { age: RETAIN_COMPLETED_SECONDS, count: RETAIN_JOB_COUNT },
      removeOnFail: { age: RETAIN_FAILED_SECONDS, count: RETAIN_JOB_COUNT },
    });
  }

  public snapshot(): WorkerStatusSnapshot {
    return {
      activeJobs: this.activeJobs,
      queues: Object.freeze([...this.queues.keys()]),
      state: this.state,
    };
  }

  public async telemetrySnapshot(): Promise<WorkerTelemetrySnapshot> {
    const queues = await Promise.all(
      [...this.queues.entries()].map(async ([name, queue]): Promise<QueueTelemetrySnapshot> => {
        const [counts, paused] = await Promise.all([
          queue.getJobCounts('waiting', 'active', 'delayed', 'failed'),
          queue.isPaused(),
        ]);
        return {
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          name,
          paused,
          waiting: counts.waiting ?? 0,
        };
      }),
    );
    return {
      activeJobs: this.activeJobs,
      queues,
      state: this.state,
    };
  }

  public async drain(): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }
    this.state = 'draining';
    const failures: unknown[] = [];
    const captureFailures = (results: readonly PromiseSettledResult<unknown>[]): void => {
      for (const result of results) {
        if (result.status === 'rejected') {
          const reason: unknown = result.reason;
          failures.push(reason);
        }
      }
    };
    captureFailures(await Promise.allSettled(this.workers.map((worker) => worker.pause(false))));
    captureFailures(await Promise.allSettled(this.workers.map((worker) => worker.close(false))));
    captureFailures(
      await Promise.allSettled([...this.queues.values()].map((queue) => queue.close())),
    );
    this.workers.length = 0;
    this.queues.clear();
    this.state = 'stopped';
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more BullMQ resources failed to close');
    }
  }
}

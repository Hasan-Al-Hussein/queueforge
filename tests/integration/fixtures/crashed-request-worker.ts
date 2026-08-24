import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import {
  EventEnvelopeSchema,
  QUEUE_NAMES,
  type EventEnvelope,
} from '../../../packages/contracts/dist/index.js';
import {
  createQueueForgeDataSource,
  RequestExecutionStore,
} from '../../../packages/persistence/dist/index.js';

interface BullJob {
  readonly data: EventEnvelope;
}

interface BullQueue {
  add(
    name: string,
    event: EventEnvelope,
    options: {
      readonly attempts: number;
      readonly backoff: { readonly type: string };
      readonly jobId: string;
      readonly removeOnComplete: { readonly age: number; readonly count: number };
      readonly removeOnFail: { readonly age: number; readonly count: number };
    },
  ): Promise<unknown>;
  waitUntilReady(): Promise<unknown>;
}

interface BullWorker {
  waitUntilReady(): Promise<unknown>;
}

interface BullModule {
  readonly Queue: new (name: string, options: Readonly<Record<string, unknown>>) => BullQueue;
  readonly Worker: new (
    name: string,
    processor: (job: BullJob) => Promise<void>,
    options: Readonly<Record<string, unknown>>,
  ) => BullWorker;
}

interface RedisClient {
  flushdb(): Promise<'OK'>;
  quit(): Promise<'OK'>;
}

type RedisConstructor = new (
  redisUrl: string,
  options: { readonly enableOfflineQueue: boolean; readonly maxRetriesPerRequest: number },
) => RedisClient;

interface PublishMessage {
  readonly event: EventEnvelope;
  readonly jobId: string;
  readonly type: 'publish';
}

function requiredEnvironment(name: 'DATABASE_URL' | 'REDIS_URL'): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required by the crashed-worker fixture`);
  }
  return value;
}

function send(message: Readonly<Record<string, unknown>>): void {
  if (process.send !== undefined) {
    process.send(message);
  }
}

function serializeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isPublishMessage(value: unknown): value is PublishMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'publish' &&
    'jobId' in value &&
    typeof value.jobId === 'string' &&
    'event' in value
  );
}

async function main(): Promise<void> {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  const redisUrl = requiredEnvironment('REDIS_URL');
  const requireFromWorker = createRequire(resolve(process.cwd(), 'apps/worker/package.json'));
  const Redis = requireFromWorker('ioredis') as RedisConstructor;
  const { Queue, Worker } = requireFromWorker('bullmq') as BullModule;
  const redis = new Redis(redisUrl, {
    enableOfflineQueue: true,
    maxRetriesPerRequest: 1,
  });
  await redis.flushdb();
  await redis.quit();

  const dataSource = createQueueForgeDataSource({
    applicationName: `queueforge-crash-fixture-${process.pid}`,
    databaseUrl,
    includeMigrations: false,
  });
  await dataSource.initialize();
  const requests = new RequestExecutionStore(dataSource);
  const workerId = `deliberately-crashed-worker-${process.pid}`;
  const workerConnection = {
    connectTimeout: 5_000,
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    url: redisUrl,
  };
  const queue = new Queue(QUEUE_NAMES.requests, {
    connection: {
      ...workerConnection,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    },
    prefix: 'queueforge',
  });
  const worker = new Worker(
    QUEUE_NAMES.requests,
    async (job: BullJob): Promise<void> => {
      const event = EventEnvelopeSchema.parse(job.data);
      const attempt = await requests.beginOrRecoverAttempt(
        { tenantId: event.tenantId },
        event.aggregateId,
        workerId,
        new Date(Date.now() - 30_000),
      );
      if (!('attemptNo' in attempt)) {
        throw new Error('Crash fixture could not begin the authoritative request attempt');
      }
      send({ attemptNo: attempt.attemptNo, requestId: event.aggregateId, type: 'claimed' });
      await new Promise<never>(() => undefined);
    },
    {
      concurrency: 1,
      connection: workerConnection,
      lockDuration: 30_000,
      maxStalledCount: Number.MAX_SAFE_INTEGER,
      name: workerId,
      prefix: 'queueforge',
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 604_800, count: 1_000 },
    },
  );
  await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);

  process.on('message', (message: unknown) => {
    if (!isPublishMessage(message)) {
      return;
    }
    void (async () => {
      const event = EventEnvelopeSchema.parse(message.event);
      await queue.add(event.eventType, event, {
        attempts: 1,
        backoff: { type: 'queueforge-bounded' },
        jobId: message.jobId,
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800, count: 1_000 },
      });
      send({ jobId: message.jobId, type: 'published' });
    })().catch((error: unknown) => {
      send({ error: serializeError(error), type: 'error' });
      process.exitCode = 1;
    });
  });
  send({ type: 'ready' });
}

void main().catch((error: unknown) => {
  send({ error: serializeError(error), type: 'error' });
  process.exitCode = 1;
});

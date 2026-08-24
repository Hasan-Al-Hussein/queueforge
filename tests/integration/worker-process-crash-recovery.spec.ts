import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';

import {
  EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  QUEUE_NAMES,
  type EventEnvelope,
} from '../../packages/contracts/src/index.js';
import {
  ProcessedEventStore,
  RequestExecutionStore,
} from '../../packages/persistence/dist/index.js';
import type { WorkerConfiguration } from '../../apps/worker/src/core/ports.js';
import type { NotificationJobHandlerService } from '../../apps/worker/src/services/notification-job-handler.service.js';
import { QueueRuntimeService } from '../../apps/worker/src/services/queue-runtime.service.js';
import { RequestExecutorService } from '../../apps/worker/src/services/request-executor.service.js';
import { RequestJobHandlerService } from '../../apps/worker/src/services/request-job-handler.service.js';
import type { WebhookJobHandlerService } from '../../apps/worker/src/services/webhook-job-handler.service.js';
import {
  cleanupTenant,
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  type TestDataSource,
} from './database-test-helpers.js';

interface FixtureMessage {
  readonly attemptNo?: number;
  readonly error?: string;
  readonly type: 'claimed' | 'error' | 'published' | 'ready';
}

interface InspectableJob {
  readonly attemptsMade: number;
  readonly attemptsStarted: number;
  getState(): Promise<string>;
}

interface InspectableQueue {
  getJob(jobId: string): Promise<InspectableJob | undefined>;
}

const REQUEST_CONSUMER = 'queueforge.request-executor.v1';

function isolatedRedisUrl(value: string): string {
  const url = new URL(value);
  url.pathname = '/12';
  return url.toString();
}

function waitForFixtureMessage(
  child: ChildProcess,
  expectedType: FixtureMessage['type'],
  timeoutMs = 10_000,
): Promise<FixtureMessage> {
  return new Promise<FixtureMessage>((resolveMessage, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Crashed-worker fixture did not send ${expectedType}`));
    }, timeoutMs);
    timer.unref();
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(
        new Error(
          `Crashed-worker fixture exited before ${expectedType} (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    };
    const onMessage = (value: unknown): void => {
      if (typeof value !== 'object' || value === null || !('type' in value)) {
        return;
      }
      const message = value as FixtureMessage;
      if (message.type === 'error') {
        cleanup();
        reject(new Error(message.error ?? 'Crashed-worker fixture failed'));
      } else if (message.type === expectedType) {
        cleanup();
        resolveMessage(message);
      }
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
    };
    child.on('error', onError);
    child.on('exit', onExit);
    child.on('message', onMessage);
  });
}

describe('real BullMQ worker process crash recovery', () => {
  let owner: TestDataSource;
  let runtimeDataSource: TestDataSource;
  const tenantIds = new Set<string>();

  beforeAll(async () => {
    owner = createOwnerDataSource('queueforge-crash-proof-owner');
    runtimeDataSource = createRuntimeDataSource('queueforge-crash-proof-runtime');
    await Promise.all([owner.initialize(), runtimeDataSource.initialize()]);
  });

  afterEach(async () => {
    for (const tenantId of tenantIds) {
      await cleanupTenant(owner, tenantId);
    }
    tenantIds.clear();
  });

  afterAll(async () => {
    await Promise.all([
      owner.isInitialized ? owner.destroy() : Promise.resolve(),
      runtimeDataSource.isInitialized ? runtimeDataSource.destroy() : Promise.resolve(),
    ]);
  });

  it('recovers a database-authoritative request after its active Bull worker is killed', async () => {
    const sourceRedisUrl = process.env['TEST_REDIS_URL'] ?? process.env['REDIS_URL'];
    if (sourceRedisUrl === undefined) {
      throw new Error('TEST_REDIS_URL or REDIS_URL is required for the crash recovery proof');
    }
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for the crash recovery proof');
    }
    const redisUrl = isolatedRedisUrl(sourceRedisUrl);
    const tenantId = randomUUID();
    tenantIds.add(tenantId);
    await insertTenant(runtimeDataSource.manager, tenantId);
    const workflow = await insertWorkflow(runtimeDataSource.manager, { tenantId });
    const requestId = randomUUID();
    const correlationId = randomUUID();
    const event: EventEnvelope = {
      aggregateId: requestId,
      aggregateType: 'workflow_request',
      correlationId,
      eventId: randomUUID(),
      eventType: EVENT_TYPES.requestQueued,
      occurredAt: new Date().toISOString(),
      payload: { requestId },
      schemaVersion: EVENT_SCHEMA_VERSION,
      tenantId,
    };
    const jobId = `qf-crash-proof-${event.eventId}`;
    await runtimeDataSource.query(
      `INSERT INTO workflow_requests
           (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
            payload, payload_hash, correlation_id, submitted_by_principal_id,
            submitted_by_principal_kind, attempt_count, max_attempts, submitted_at,
            status_changed_at)
         VALUES ($1, $2, $3, $4, 'queued', 'system', '{}'::jsonb, $5, $6, $7,
                 'system', 0, 3, clock_timestamp(), clock_timestamp())`,
      [
        tenantId,
        requestId,
        workflow.templateId,
        workflow.versionId,
        '0'.repeat(64),
        correlationId,
        randomUUID(),
      ],
    );

    const fixturePath = resolve(
      process.cwd(),
      'tests/integration/fixtures/crashed-request-worker.ts',
    );
    const child = fork(fixturePath, [], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl, REDIS_URL: redisUrl },
      execArgv: ['--import', 'tsx'],
      silent: true,
    });
    const childLogs: string[] = [];
    child.stdout?.on('data', (chunk: Buffer) => childLogs.push(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => childLogs.push(chunk.toString('utf8')));
    let recoveryRuntime: QueueRuntimeService | undefined;

    try {
      await waitForFixtureMessage(child, 'ready');
      const claimed = waitForFixtureMessage(child, 'claimed');
      child.send({ event, jobId, type: 'publish' });
      await expect(claimed).resolves.toMatchObject({ attemptNo: 1, type: 'claimed' });

      const processingState = (await runtimeDataSource.query(
        `SELECT status, attempt_count FROM workflow_requests
           WHERE tenant_id = $1 AND id = $2`,
        [tenantId, requestId],
      )) as unknown as Array<{ attempt_count: number; status: string }>;
      expect(processingState[0]).toEqual({ attempt_count: 1, status: 'processing' });

      const childExit = once(child, 'exit');
      expect(child.kill('SIGKILL')).toBe(true);
      await childExit;

      let resolveRecovered: (() => void) | undefined;
      const recovered = new Promise<void>((resolveRecovery) => {
        resolveRecovered = resolveRecovery;
      });
      const configuration: WorkerConfiguration = {
        allowPrivateNetworks: true,
        allowedWebhookHosts: new Set(['127.0.0.1']),
        concurrency: 1,
        databaseUrl,
        heartbeatIntervalMs: 10_000,
        leaseSeconds: 30,
        outboxPollIntervalMs: 1_000,
        redisUrl,
        requestTimeoutMs: 5_000,
        webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
        webhookTimeoutMs: 1_000,
      };
      const recoveryWorkerId = `crash-recovery-worker-${randomUUID()}`;
      const realRequestHandler = new RequestJobHandlerService(
        new ProcessedEventStore(runtimeDataSource),
        new RequestExecutionStore(runtimeDataSource),
        new RequestExecutorService(),
        configuration,
        recoveryWorkerId,
      );
      const observableRequestHandler = {
        handle: async (job: Parameters<RequestJobHandlerService['handle']>[0]) => {
          await realRequestHandler.handle(job);
          resolveRecovered?.();
        },
      } as RequestJobHandlerService;
      recoveryRuntime = new QueueRuntimeService(
        observableRequestHandler,
        { handle: async () => undefined } as unknown as WebhookJobHandlerService,
        { handle: async () => undefined } as unknown as NotificationJobHandlerService,
        configuration,
        recoveryWorkerId,
      );

      const recoveryStartedAt = Date.now();
      await recoveryRuntime.start();
      const recoveryTimeout = new Promise<never>((_resolve, reject) => {
        const handle = setTimeout(
          () => reject(new Error('Killed BullMQ job was not recovered within 70 seconds')),
          70_000,
        );
        handle.unref();
      });
      await expect(Promise.race([recovered, recoveryTimeout])).resolves.toBeUndefined();

      const finalState = (await runtimeDataSource.query(
        `SELECT request.status, request.attempt_count,
                  (SELECT count(*)::integer FROM request_attempts attempt
                   WHERE attempt.tenant_id = request.tenant_id AND attempt.request_id = request.id
                     AND attempt.outcome = 'timed_out') AS timed_out_attempts,
                  (SELECT count(*)::integer FROM request_attempts attempt
                   WHERE attempt.tenant_id = request.tenant_id AND attempt.request_id = request.id
                     AND attempt.outcome = 'succeeded') AS succeeded_attempts,
                  (SELECT count(*)::integer FROM processed_events receipt
                   WHERE receipt.tenant_id = request.tenant_id AND receipt.consumer = $3
                     AND receipt.event_id = $4) AS receipts
           FROM workflow_requests request
           WHERE request.tenant_id = $1 AND request.id = $2`,
        [tenantId, requestId, REQUEST_CONSUMER, event.eventId],
      )) as unknown as Array<{
        attempt_count: number;
        receipts: number;
        status: string;
        succeeded_attempts: number;
        timed_out_attempts: number;
      }>;
      expect(finalState[0]).toEqual({
        attempt_count: 2,
        receipts: 1,
        status: 'succeeded',
        succeeded_attempts: 1,
        timed_out_attempts: 1,
      });

      const queue = (
        recoveryRuntime as unknown as { readonly queues: Map<string, InspectableQueue> }
      ).queues.get(QUEUE_NAMES.requests);
      const recoveredJob = await queue?.getJob(jobId);
      expect(await recoveredJob?.getState()).toBe('completed');
      expect(recoveredJob?.attemptsMade).toBe(1);
      expect(recoveredJob?.attemptsStarted).toBeGreaterThanOrEqual(2);
      expect(Date.now() - recoveryStartedAt).toBeGreaterThanOrEqual(25_000);
    } catch (error) {
      const logs = childLogs.join('').trim();
      if (logs.length > 0) {
        throw new AggregateError([error], `Crash recovery proof failed. Child output:\n${logs}`);
      }
      throw error;
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await recoveryRuntime?.drain();
    }
  }, 90_000);
});

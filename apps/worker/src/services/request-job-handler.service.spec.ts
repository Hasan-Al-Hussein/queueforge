import { randomUUID } from 'node:crypto';

import type { Job } from 'bullmq';

import { EVENT_SCHEMA_VERSION, EVENT_TYPES, type EventEnvelope } from '@queueforge/contracts';
import type { ProcessedEventStore, RequestExecutionStore } from '@queueforge/persistence';

import type { WorkerConfiguration } from '../core/ports.js';
import { RequestExecutorService } from './request-executor.service.js';
import { RequestJobHandlerService } from './request-job-handler.service.js';

const configuration: WorkerConfiguration = {
  allowPrivateNetworks: true,
  allowedWebhookHosts: new Set(['127.0.0.1']),
  concurrency: 1,
  databaseUrl: 'postgresql://queueforge.invalid/queueforge',
  heartbeatIntervalMs: 10_000,
  leaseSeconds: 30,
  outboxPollIntervalMs: 1_000,
  redisUrl: 'redis://127.0.0.1:6379',
  requestTimeoutMs: 5_000,
  webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
  webhookTimeoutMs: 1_000,
};

function eventFixture(requestId: string): EventEnvelope {
  return {
    aggregateId: requestId,
    aggregateType: 'workflow_request',
    correlationId: randomUUID(),
    eventId: randomUUID(),
    eventType: EVENT_TYPES.requestQueued,
    occurredAt: new Date().toISOString(),
    payload: { requestId },
    schemaVersion: EVENT_SCHEMA_VERSION,
    tenantId: randomUUID(),
  };
}

function jobFor(event: EventEnvelope): Job {
  return {
    data: event,
    updateProgress: jest.fn().mockResolvedValue(undefined),
  } as unknown as Job;
}

describe('RequestJobHandlerService terminal receipts', () => {
  it('short-circuits an already processed replay before acquiring a request attempt', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const has = jest.fn().mockResolvedValue(true);
    const beginOrRecoverAttempt = jest.fn();
    const handler = new RequestJobHandlerService(
      { has } as unknown as ProcessedEventStore,
      { beginOrRecoverAttempt } as unknown as RequestExecutionStore,
      new RequestExecutorService(),
      configuration,
      'worker-test',
    );

    await handler.handle(jobFor(event));

    expect(has).toHaveBeenCalledWith(
      event.tenantId,
      'queueforge.request-executor.v1',
      event.eventId,
    );
    expect(beginOrRecoverAttempt).not.toHaveBeenCalled();
  });

  it('uses the terminal-aware atomic failure method before returning a dead-lettered job', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const completeFailedOnce = jest.fn().mockResolvedValue('dead_lettered');
    const requests = {
      beginOrRecoverAttempt: jest.fn().mockResolvedValue({
        attemptNo: 5,
        budgetAttemptNo: 2,
        correlationId: event.correlationId,
        processingConfig: { durationMs: 0, failuresBeforeSuccess: 10 },
        processorConfig: { handler: 'demo' },
        startedAt: new Date(),
      }),
      completeFailedOnce,
    } as unknown as RequestExecutionStore;
    const executor = {
      execute: jest.fn().mockRejectedValue(new Error('simulated terminal failure')),
      parseRequestId: jest.fn().mockReturnValue(requestId),
    } as unknown as RequestExecutorService;
    const handler = new RequestJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      requests,
      executor,
      configuration,
      'worker-test',
    );

    await expect(handler.handle(jobFor(event))).resolves.toBeUndefined();
    expect(completeFailedOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.request-executor.v1',
      expect.objectContaining({ attemptNo: 5, requestId }),
    );
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({ attemptNo: 2 }));
  });

  it('passes the receipt binding into interrupted-attempt recovery', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const beginOrRecoverAttempt = jest.fn().mockResolvedValue({ deadLettered: true });
    const handler = new RequestJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      { beginOrRecoverAttempt } as unknown as RequestExecutionStore,
      new RequestExecutorService(),
      configuration,
      'worker-test',
    );

    await handler.handle(jobFor(event));

    expect(beginOrRecoverAttempt).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      requestId,
      'worker-test',
      expect.any(Date),
      {
        consumer: 'queueforge.request-executor.v1',
        eventId: event.eventId,
      },
    );
  });

  it('completes attempt 11 when immutable processing configuration requires ten failures', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const completeSucceededOnce = jest.fn().mockResolvedValue('processed');
    const completeFailedOnce = jest.fn();
    const handler = new RequestJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        beginOrRecoverAttempt: jest.fn().mockResolvedValue({
          attemptNo: 11,
          budgetAttemptNo: 11,
          correlationId: event.correlationId,
          processingConfig: {
            durationMs: 0,
            failuresBeforeSuccess: 10,
            maxAttempts: 11,
          },
          processorConfig: { handler: 'demo' },
          startedAt: new Date(),
        }),
        completeFailedOnce,
        completeSucceededOnce,
      } as unknown as RequestExecutionStore,
      new RequestExecutorService(),
      configuration,
      'worker-test',
    );

    await expect(handler.handle(jobFor(event))).resolves.toBeUndefined();

    expect(completeFailedOnce).not.toHaveBeenCalled();
    expect(completeSucceededOnce).toHaveBeenCalledWith(
      { tenantId: event.tenantId },
      event.eventId,
      'queueforge.request-executor.v1',
      expect.objectContaining({ attemptNo: 11, requestId }),
    );
  });

  it('never records processor failure when the successful receipt write fails', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const persistenceFailure = new Error('transient persistence failure');
    const completeFailedOnce = jest.fn();
    const execute = jest.fn().mockResolvedValue(undefined);
    const handler = new RequestJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        beginOrRecoverAttempt: jest.fn().mockResolvedValue({
          attemptNo: 1,
          budgetAttemptNo: 1,
          correlationId: event.correlationId,
          processingConfig: { durationMs: 0, failuresBeforeSuccess: 0 },
          processorConfig: { handler: 'demo' },
          startedAt: new Date(),
        }),
        completeFailedOnce,
        completeSucceededOnce: jest.fn().mockRejectedValue(persistenceFailure),
      } as unknown as RequestExecutionStore,
      {
        execute,
        parseRequestId: jest.fn().mockReturnValue(requestId),
      } as unknown as RequestExecutorService,
      configuration,
      'worker-test',
    );

    await expect(handler.handle(jobFor(event))).rejects.toBe(persistenceFailure);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(completeFailedOnce).not.toHaveBeenCalled();
  });

  it('treats Redis progress failures as observational and still records success', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const completeFailedOnce = jest.fn();
    const completeSucceededOnce = jest.fn().mockResolvedValue('processed');
    const handler = new RequestJobHandlerService(
      { has: jest.fn().mockResolvedValue(false) } as unknown as ProcessedEventStore,
      {
        beginOrRecoverAttempt: jest.fn().mockResolvedValue({
          attemptNo: 1,
          budgetAttemptNo: 1,
          correlationId: event.correlationId,
          processingConfig: { durationMs: 0, failuresBeforeSuccess: 0 },
          processorConfig: { handler: 'demo' },
          startedAt: new Date(),
        }),
        completeFailedOnce,
        completeSucceededOnce,
      } as unknown as RequestExecutionStore,
      new RequestExecutorService(),
      configuration,
      'worker-test',
    );
    const job = jobFor(event);
    job.updateProgress = jest.fn().mockRejectedValue(new Error('Redis unavailable'));

    await expect(handler.handle(job)).resolves.toBeUndefined();
    expect(job.updateProgress).toHaveBeenCalled();
    expect(completeSucceededOnce).toHaveBeenCalled();
    expect(completeFailedOnce).not.toHaveBeenCalled();
  });
});

describe('RequestExecutorService immutable processing configuration', () => {
  it('takes retry simulation from the workflow version instead of the queue envelope', async () => {
    const requestId = randomUUID();
    const event = eventFixture(requestId);
    const executor = new RequestExecutorService();

    await expect(
      executor.execute({
        attemptNo: 1,
        event,
        processingConfig: { durationMs: 0, failuresBeforeSuccess: 1 },
        processorConfig: { handler: 'demo' },
        reportProgress: jest.fn().mockResolvedValue(undefined),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Injected local workflow failure');

    await expect(
      executor.execute({
        attemptNo: 2,
        event,
        processingConfig: { durationMs: 0, failuresBeforeSuccess: 1 },
        processorConfig: { handler: 'demo' },
        reportProgress: jest.fn().mockResolvedValue(undefined),
        signal: new AbortController().signal,
      }),
    ).resolves.toBeUndefined();
  });
});

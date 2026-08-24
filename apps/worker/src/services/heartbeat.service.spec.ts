import type { WorkerHeartbeatStore } from '@queueforge/persistence';

import type { WorkerConfiguration } from '../core/ports.js';
import { HeartbeatService } from './heartbeat.service.js';
import type { QueueRuntimeService } from './queue-runtime.service.js';

const configuration: WorkerConfiguration = {
  allowPrivateNetworks: true,
  allowedWebhookHosts: new Set(['127.0.0.1']),
  concurrency: 1,
  databaseUrl: 'postgresql://queueforge.invalid/queueforge',
  heartbeatIntervalMs: 10,
  leaseSeconds: 30,
  outboxPollIntervalMs: 1_000,
  redisUrl: 'redis://127.0.0.1:6379',
  requestTimeoutMs: 5_000,
  webhookMasterKeyBase64: Buffer.alloc(32).toString('base64'),
  webhookTimeoutMs: 1_000,
};

describe('HeartbeatService shutdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for an inflight heartbeat and never reschedules after stop', async () => {
    let releaseBeat: (() => void) | undefined;
    const beatGate = new Promise<void>((resolve) => {
      releaseBeat = resolve;
    });
    const beat = jest.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(beatGate);
    const remove = jest.fn().mockResolvedValue(undefined);
    const service = new HeartbeatService(
      { beat, remove } as unknown as WorkerHeartbeatStore,
      {
        telemetrySnapshot: jest.fn().mockResolvedValue({
          activeJobs: 0,
          queues: [],
          state: 'running',
        }),
      } as unknown as QueueRuntimeService,
      configuration,
      'worker-test',
    );

    await service.start();
    await jest.advanceTimersByTimeAsync(configuration.heartbeatIntervalMs);
    expect(beat).toHaveBeenCalledTimes(2);

    let stopped = false;
    const stopping = service.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(remove).not.toHaveBeenCalled();

    releaseBeat?.();
    await stopping;
    await jest.advanceTimersByTimeAsync(configuration.heartbeatIntervalMs * 3);

    expect(remove).toHaveBeenCalledWith('worker-test');
    expect(beat).toHaveBeenCalledTimes(2);
  });
});

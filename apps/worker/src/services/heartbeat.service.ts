import { hostname } from 'node:os';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { WorkerHeartbeatStore } from '@queueforge/persistence';

import { safeErrorMessage } from '../core/errors.js';
import { WORKER_CONFIGURATION, WORKER_ID, type WorkerConfiguration } from '../core/ports.js';
import { QueueRuntimeService } from './queue-runtime.service.js';

const SERVICE_NAME = 'queueforge-worker';
const SERVICE_VERSION = '0.1.0';

@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);
  private readonly startedAt = new Date();
  private active = false;
  private inFlight: Promise<void> | undefined;
  private timer: NodeJS.Timeout | undefined;
  private status: 'running' | 'draining' = 'running';

  public constructor(
    private readonly heartbeats: WorkerHeartbeatStore,
    private readonly queueRuntime: QueueRuntimeService,
    @Inject(WORKER_CONFIGURATION) private readonly configuration: WorkerConfiguration,
    @Inject(WORKER_ID) private readonly workerId: string,
  ) {}

  public async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    this.status = 'running';
    try {
      await this.publishHeartbeat();
      this.schedule();
    } catch (error) {
      this.active = false;
      throw error;
    }
  }

  public async beginDraining(): Promise<void> {
    this.status = 'draining';
    await this.inFlight;
    await this.publishHeartbeat();
  }

  public async stop(): Promise<void> {
    this.active = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.inFlight;
    await this.heartbeats.remove(this.workerId);
  }

  private schedule(): void {
    if (!this.active || this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.publishHeartbeat()
        .catch((error: unknown) => {
          this.logger.error({ error: safeErrorMessage(error) }, 'Worker heartbeat failed');
        })
        .finally(() => {
          if (this.active) {
            this.schedule();
          }
        });
    }, this.configuration.heartbeatIntervalMs);
    this.timer.unref();
  }

  private publishHeartbeat(): Promise<void> {
    if (this.inFlight !== undefined) {
      return this.inFlight;
    }
    const operation = this.beat().finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = undefined;
      }
    });
    this.inFlight = operation;
    return operation;
  }

  private async beat(): Promise<void> {
    const snapshot = await this.queueRuntime.telemetrySnapshot();
    await this.heartbeats.beat(this.workerId, SERVICE_NAME, SERVICE_VERSION, this.startedAt, {
      activeJobs: snapshot.activeJobs,
      host: hostname(),
      processId: process.pid,
      queues: snapshot.queues.map((queue) => ({ ...queue })),
      state: this.status,
    });
  }
}

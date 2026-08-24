import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';

import { safeErrorMessage } from '../core/errors.js';
import { HeartbeatService } from './heartbeat.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { QueueRuntimeService } from './queue-runtime.service.js';

@Injectable()
export class WorkerOrchestratorService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorkerOrchestratorService.name);
  private closing: Promise<void> | undefined;

  public constructor(
    private readonly queueRuntime: QueueRuntimeService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly heartbeat: HeartbeatService,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queueRuntime.start();
      await this.heartbeat.start();
      await this.dispatcher.start();
      this.logger.log('QueueForge worker is ready');
    } catch (error) {
      await this.shutdown('startup failure').catch(() => undefined);
      throw error;
    }
  }

  public async beforeApplicationShutdown(signal?: string): Promise<void> {
    await this.shutdown(signal ?? 'application close');
  }

  public shutdown(reason: string): Promise<void> {
    if (this.closing !== undefined) {
      return this.closing;
    }
    this.closing = this.performShutdown(reason);
    return this.closing;
  }

  private async performShutdown(reason: string): Promise<void> {
    this.logger.log({ reason }, 'QueueForge worker is draining');
    await this.heartbeat.beginDraining().catch((error: unknown) => {
      this.logger.warn({ error: safeErrorMessage(error) }, 'Could not publish draining heartbeat');
    });
    const released = await this.dispatcher.stop(reason).catch((error: unknown) => {
      this.logger.error({ error: safeErrorMessage(error) }, 'Could not release outbox leases');
      return 0;
    });
    await this.queueRuntime.drain();
    await this.heartbeat.stop().catch((error: unknown) => {
      this.logger.warn({ error: safeErrorMessage(error) }, 'Could not remove worker heartbeat');
    });
    this.logger.log({ released }, 'QueueForge worker stopped');
  }
}

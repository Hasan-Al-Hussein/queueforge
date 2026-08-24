import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

import { DynamicModule, Module } from '@nestjs/common';

import { splitCommaSeparated, type WorkerEnvironment } from '@queueforge/config';
import { ObservabilityModule } from '@queueforge/observability';
import {
  NotificationStore,
  OutboxStore,
  PersistenceModule,
  ProcessedEventStore,
  RequestExecutionStore,
  WebhookDeliveryStore,
  WebhookSecretStore,
  WorkerHeartbeatStore,
} from '@queueforge/persistence';

import { ConsoleNotificationProvider } from './adapters/console-notification.provider.js';
import { DatabaseWebhookSecretProvider } from './adapters/database-webhook-secret.provider.js';
import {
  NOTIFICATION_PROVIDER,
  OUTBOX_STORE,
  QUEUE_PUBLISHER,
  WEBHOOK_SECRET_PROVIDER,
  WORKER_CONFIGURATION,
  WORKER_ID,
  type WorkerConfiguration,
} from './core/ports.js';
import { HeartbeatService } from './services/heartbeat.service.js';
import { NotificationJobHandlerService } from './services/notification-job-handler.service.js';
import { OutboxDispatcherService } from './services/outbox-dispatcher.service.js';
import { QueueRuntimeService } from './services/queue-runtime.service.js';
import { RequestExecutorService } from './services/request-executor.service.js';
import { RequestJobHandlerService } from './services/request-job-handler.service.js';
import { WebhookJobHandlerService } from './services/webhook-job-handler.service.js';
import { WorkerOrchestratorService } from './services/worker-orchestrator.service.js';

export function createWorkerConfiguration(environment: WorkerEnvironment): WorkerConfiguration {
  const allowedWebhookHosts = new Set(
    splitCommaSeparated(environment.OUTBOUND_ALLOWED_HOSTS).map((host) =>
      host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host,
    ),
  );
  if (allowedWebhookHosts.size === 0) {
    throw new Error('At least one outbound webhook host must be allowlisted');
  }
  return Object.freeze({
    allowPrivateNetworks: environment.OUTBOUND_ALLOW_PRIVATE_NETWORKS,
    allowedWebhookHosts,
    concurrency: environment.WORKER_CONCURRENCY,
    databaseUrl: environment.DATABASE_URL,
    heartbeatIntervalMs: environment.WORKER_HEARTBEAT_SECONDS * 1_000,
    leaseSeconds: environment.OUTBOX_LEASE_SECONDS,
    outboxPollIntervalMs: environment.OUTBOX_POLL_INTERVAL_MS,
    redisUrl: environment.REDIS_URL,
    requestTimeoutMs: environment.REQUEST_JOB_TIMEOUT_MS,
    webhookMasterKeyBase64: environment.WEBHOOK_MASTER_KEY,
    webhookTimeoutMs: environment.WEBHOOK_TIMEOUT_MS,
  });
}

@Module({})
export class WorkerModule {
  public static register(environment: WorkerEnvironment): DynamicModule {
    const configuration = createWorkerConfiguration(environment);
    const workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
    return {
      module: WorkerModule,
      imports: [
        ObservabilityModule.forRoot({
          environment: environment.NODE_ENV,
          logLevel: environment.LOG_LEVEL,
          serviceName: 'queueforge-worker',
        }),
        PersistenceModule.forRoot(
          environment.DATABASE_URL,
          environment.NODE_ENV === 'development' && environment.LOG_LEVEL === 'debug',
        ),
      ],
      providers: [
        { provide: WORKER_CONFIGURATION, useValue: configuration },
        { provide: WORKER_ID, useValue: workerId },
        OutboxStore,
        ProcessedEventStore,
        RequestExecutionStore,
        WebhookDeliveryStore,
        WebhookSecretStore,
        NotificationStore,
        WorkerHeartbeatStore,
        ConsoleNotificationProvider,
        DatabaseWebhookSecretProvider,
        RequestExecutorService,
        RequestJobHandlerService,
        WebhookJobHandlerService,
        NotificationJobHandlerService,
        QueueRuntimeService,
        OutboxDispatcherService,
        HeartbeatService,
        WorkerOrchestratorService,
        { provide: OUTBOX_STORE, useExisting: OutboxStore },
        { provide: QUEUE_PUBLISHER, useExisting: QueueRuntimeService },
        { provide: WEBHOOK_SECRET_PROVIDER, useExisting: DatabaseWebhookSecretProvider },
        { provide: NOTIFICATION_PROVIDER, useExisting: ConsoleNotificationProvider },
      ],
    };
  }
}

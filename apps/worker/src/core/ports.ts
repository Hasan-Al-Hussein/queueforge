import type { EventEnvelope, JsonObject } from '@queueforge/contracts';

import type { QueueName } from './jobs.js';

export interface TenantScope {
  readonly tenantId: string;
}

export interface ClaimedOutboxEvent {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly attemptCount: number;
  readonly correlationId: string;
  readonly eventType: string;
  readonly id: string;
  readonly leaseOwner: string;
  readonly leaseUntil: Date;
  readonly maxAttempts: number;
  readonly occurredAt: Date;
  readonly payload: JsonObject;
  readonly schemaVersion: number;
  readonly tenantId: string;
}

export interface OutboxStorePort {
  claimBatch(
    leaseOwner: string,
    leaseSeconds: number,
    limit?: number,
  ): Promise<readonly ClaimedOutboxEvent[]>;
  markFailed(
    tenantId: string,
    eventId: string,
    leaseOwner: string,
    errorMessage: string,
    retryAt: Date,
  ): Promise<'retry' | 'dead' | 'stale_lease'>;
  markPublished(tenantId: string, eventId: string, leaseOwner: string): Promise<boolean>;
  recoverExpiredLeases(limit?: number): Promise<number>;
  releaseOwnerLeases(leaseOwner: string, reason: string): Promise<number>;
}

export interface QueuePublishOptions {
  readonly attempts: number;
  readonly backoffType: string;
  readonly jobId: string;
}

export interface QueuePublisherPort {
  publish(queueName: QueueName, event: EventEnvelope, options: QueuePublishOptions): Promise<void>;
}

export interface WorkerStatusSnapshot {
  readonly activeJobs: number;
  readonly queues: readonly QueueName[];
  readonly state: 'running' | 'draining' | 'stopped';
}

export interface QueueTelemetrySnapshot {
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly name: QueueName;
  readonly paused: boolean;
  readonly waiting: number;
}

export interface WorkerTelemetrySnapshot {
  readonly activeJobs: number;
  readonly queues: readonly QueueTelemetrySnapshot[];
  readonly state: 'running' | 'draining' | 'stopped';
}

export interface WebhookSecretProviderPort {
  getSigningSecret(scope: TenantScope, endpointId: string, keyId: string): Promise<string>;
}

export interface NotificationMessage {
  readonly body: string;
  readonly id: string;
  readonly recipientKind: 'user' | 'role';
  readonly recipientRef: string;
  readonly title: string;
}

export interface NotificationProviderPort {
  readonly name: 'console';
  deliver(scope: TenantScope, notification: NotificationMessage): Promise<void>;
}

export const OUTBOX_STORE = Symbol('OUTBOX_STORE');
export const QUEUE_PUBLISHER = Symbol('QUEUE_PUBLISHER');
export const WORKER_CONFIGURATION = Symbol('WORKER_CONFIGURATION');
export const WORKER_ID = Symbol('WORKER_ID');
export const WEBHOOK_SECRET_PROVIDER = Symbol('WEBHOOK_SECRET_PROVIDER');
export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');

export interface WorkerConfiguration {
  readonly allowPrivateNetworks: boolean;
  readonly allowedWebhookHosts: ReadonlySet<string>;
  readonly concurrency: number;
  readonly databaseUrl: string;
  readonly heartbeatIntervalMs: number;
  readonly leaseSeconds: number;
  readonly outboxPollIntervalMs: number;
  readonly redisUrl: string;
  readonly requestTimeoutMs: number;
  readonly webhookMasterKeyBase64: string;
  readonly webhookTimeoutMs: number;
}

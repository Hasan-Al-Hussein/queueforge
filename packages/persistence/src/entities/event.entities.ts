import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type { JsonObject, PrincipalKind } from '@queueforge/contracts';

import { TenantOwnedEntity } from './base.entity.js';

@Entity({ name: 'outbox_events' })
@Index(['tenantId', 'status', 'availableAt'])
export class OutboxEventEntity extends TenantOwnedEntity {
  @Column('text', { name: 'event_type' })
  public eventType!: string;

  @Column('text', { name: 'aggregate_type' })
  public aggregateType!: string;

  @Column('uuid', { name: 'aggregate_id' })
  public aggregateId!: string;

  @Column('uuid', { name: 'correlation_id' })
  public correlationId!: string;

  @Column('integer', { name: 'schema_version' })
  public schemaVersion!: number;

  @Column('jsonb')
  public payload!: JsonObject;

  @Column('text', { default: 'pending' })
  public status!: 'pending' | 'publishing' | 'retry' | 'published' | 'dead';

  @Column('integer', { default: 0, name: 'attempt_count' })
  public attemptCount!: number;

  @Column('integer', { default: 0, name: 'attempt_sequence' })
  public attemptSequence!: number;

  @Column('integer', { default: 10, name: 'max_attempts' })
  public maxAttempts!: number;

  @Column('timestamptz', { name: 'available_at' })
  public availableAt!: Date;

  @Column('text', { name: 'lease_owner', nullable: true })
  public leaseOwner!: string | null;

  @Column('timestamptz', { name: 'lease_until', nullable: true })
  public leaseUntil!: Date | null;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  public publishedAt!: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  public lastError!: string | null;
}

@Entity({ name: 'outbox_attempts' })
@Index(['tenantId', 'outboxEventId', 'attemptNo', 'outcome'], { unique: true })
export class OutboxAttemptEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'outbox_event_id' })
  public outboxEventId!: string;

  @Column('integer', { name: 'attempt_no' })
  public attemptNo!: number;

  @Column('text')
  public outcome!: 'claimed' | 'published' | 'failed' | 'lease_expired';

  @Column('text', { name: 'worker_id' })
  public workerId!: string;

  @Column('text', { name: 'error_message', nullable: true })
  public errorMessage!: string | null;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}

@Entity({ name: 'processed_events' })
export class ProcessedEventEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('text')
  public consumer!: string;

  @PrimaryColumn('uuid', { name: 'event_id' })
  public eventId!: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  public processedAt!: Date;
}

@Entity({ name: 'audit_events' })
@Index(['tenantId', 'occurredAt'])
@Index(['tenantId', 'correlationId'])
export class AuditEventEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('text', { name: 'event_type' })
  public eventType!: string;

  @Column('uuid', { name: 'actor_principal_id', nullable: true })
  public actorPrincipalId!: string | null;

  @Column('text', { name: 'actor_principal_kind' })
  public actorPrincipalKind!: PrincipalKind;

  @Column('text', { name: 'resource_type' })
  public resourceType!: string;

  @Column('uuid', { name: 'resource_id', nullable: true })
  public resourceId!: string | null;

  @Column('uuid', { name: 'correlation_id' })
  public correlationId!: string;

  @Column('jsonb', { default: {}, name: 'safe_metadata' })
  public safeMetadata!: JsonObject;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}

@Entity({ name: 'notifications' })
@Index(['tenantId', 'status', 'createdAt'])
export class NotificationEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'request_id', nullable: true })
  public requestId!: string | null;

  @Column('text', { name: 'recipient_kind' })
  public recipientKind!: 'user' | 'role';

  @Column('text', { name: 'recipient_ref' })
  public recipientRef!: string;

  @Column('text')
  public title!: string;

  @Column('text')
  public body!: string;

  @Column('text', { default: 'pending' })
  public status!: 'pending' | 'delivered' | 'failed';

  @Column('timestamptz', { name: 'read_at', nullable: true })
  public readAt!: Date | null;
}

@Entity({ name: 'notification_deliveries' })
export class NotificationDeliveryEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'notification_id' })
  public notificationId!: string;

  @Column('text')
  public provider!: 'in_app' | 'console';

  @Column('text')
  public status!: 'delivered' | 'failed';

  @Column('text', { name: 'error_message', nullable: true })
  public errorMessage!: string | null;

  @Column('timestamptz', { name: 'delivered_at', nullable: true })
  public deliveredAt!: Date | null;
}

@Entity({ name: 'worker_nodes' })
export class WorkerNodeEntity {
  @PrimaryColumn('text')
  public id!: string;

  @Column('text')
  public service!: string;

  @Column('text')
  public version!: string;

  @Column('timestamptz', { name: 'started_at' })
  public startedAt!: Date;

  @Column('timestamptz', { name: 'heartbeat_at' })
  public heartbeatAt!: Date;

  @Column('jsonb', { default: {} })
  public metadata!: JsonObject;
}

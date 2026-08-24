import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import type {
  JsonObject,
  PrincipalKind,
  RequestSource,
  WorkflowRequestStatus,
} from '@queueforge/contracts';

import { TenantOwnedEntity } from './base.entity.js';

@Entity({ name: 'workflow_requests' })
@Index(['tenantId', 'status', 'submittedAt'])
@Index(['tenantId', 'correlationId'])
export class WorkflowRequestEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'workflow_template_id' })
  public workflowTemplateId!: string;

  @Column('uuid', { name: 'workflow_version_id' })
  public workflowVersionId!: string;

  @Column('text')
  public status!: WorkflowRequestStatus;

  @Column('text')
  public source!: RequestSource;

  @Column('jsonb')
  public payload!: JsonObject;

  @Column('text', { name: 'payload_hash' })
  public payloadHash!: string;

  @Column('uuid', { name: 'correlation_id' })
  public correlationId!: string;

  @Column('uuid', { name: 'submitted_by_principal_id' })
  public submittedByPrincipalId!: string;

  @Column('text', { name: 'submitted_by_principal_kind' })
  public submittedByPrincipalKind!: PrincipalKind;

  @Column('integer', { default: 0, name: 'attempt_count' })
  public attemptCount!: number;

  @Column('integer', { default: 5, name: 'max_attempts' })
  public maxAttempts!: number;

  @Column('timestamptz', { name: 'submitted_at' })
  public submittedAt!: Date;

  @Column('timestamptz', { name: 'status_changed_at' })
  public statusChangedAt!: Date;

  @Column('text', { name: 'last_error_code', nullable: true })
  public lastErrorCode!: string | null;

  @Column('text', { name: 'last_error_message', nullable: true })
  public lastErrorMessage!: string | null;
}

@Entity({ name: 'request_transitions' })
@Index(['tenantId', 'requestId', 'occurredAt'])
export class RequestTransitionEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'request_id' })
  public requestId!: string;

  @Column('text', { name: 'from_status', nullable: true })
  public fromStatus!: WorkflowRequestStatus | null;

  @Column('text', { name: 'to_status' })
  public toStatus!: WorkflowRequestStatus;

  @Column('uuid', { name: 'actor_principal_id', nullable: true })
  public actorPrincipalId!: string | null;

  @Column('text', { name: 'actor_principal_kind' })
  public actorPrincipalKind!: PrincipalKind;

  @Column('text')
  public reason!: string;

  @Column('jsonb', { default: {}, name: 'safe_metadata' })
  public safeMetadata!: JsonObject;

  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' })
  public occurredAt!: Date;
}

@Entity({ name: 'request_attempts' })
@Index(['tenantId', 'requestId', 'attemptNo'], { unique: true })
export class RequestAttemptEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'request_id' })
  public requestId!: string;

  @Column('integer', { name: 'attempt_no' })
  public attemptNo!: number;

  @Column('text')
  public outcome!: 'processing' | 'succeeded' | 'failed' | 'timed_out';

  @Column('text', { name: 'worker_id', nullable: true })
  public workerId!: string | null;

  @Column('timestamptz', { name: 'started_at' })
  public startedAt!: Date;

  @Column('timestamptz', { name: 'finished_at', nullable: true })
  public finishedAt!: Date | null;

  @Column('text', { name: 'error_code', nullable: true })
  public errorCode!: string | null;

  @Column('text', { name: 'error_message', nullable: true })
  public errorMessage!: string | null;
}

@Entity({ name: 'approval_tasks' })
@Index(['tenantId', 'status', 'createdAt'])
export class ApprovalTaskEntity extends TenantOwnedEntity {
  @Column('uuid', { name: 'request_id', unique: true })
  public requestId!: string;

  @Column('uuid', { name: 'workflow_version_id' })
  public workflowVersionId!: string;

  @Column('text', { name: 'payload_hash' })
  public payloadHash!: string;

  @Column('text')
  public status!: 'pending' | 'approved' | 'rejected' | 'cancelled';

  @Column('integer', { default: 1 })
  public revision!: number;

  @Column('boolean', { name: 'prevent_self_approval' })
  public preventSelfApproval!: boolean;

  @Column('uuid', { name: 'requester_principal_id' })
  public requesterPrincipalId!: string;

  @Column('text', { name: 'requester_principal_kind' })
  public requesterPrincipalKind!: PrincipalKind;

  @Column('timestamptz', { name: 'decided_at', nullable: true })
  public decidedAt!: Date | null;
}

@Entity({ name: 'approval_decisions' })
export class ApprovalDecisionEntity {
  @PrimaryColumn('uuid', { name: 'tenant_id' })
  public tenantId!: string;

  @PrimaryColumn('uuid')
  public id!: string;

  @Column('uuid', { name: 'approval_task_id', unique: true })
  public approvalTaskId!: string;

  @Column('uuid', { name: 'request_id' })
  public requestId!: string;

  @Column('uuid', { name: 'workflow_version_id' })
  public workflowVersionId!: string;

  @Column('text', { name: 'payload_hash' })
  public payloadHash!: string;

  @Column('text')
  public decision!: 'approved' | 'rejected';

  @Column('text', { nullable: true })
  public note!: string | null;

  @Column('uuid', { name: 'actor_principal_id' })
  public actorPrincipalId!: string;

  @Column('text', { name: 'actor_principal_kind' })
  public actorPrincipalKind!: PrincipalKind;

  @CreateDateColumn({ name: 'decided_at', type: 'timestamptz' })
  public decidedAt!: Date;
}

@Entity({ name: 'idempotency_records' })
@Index(['tenantId', 'endpointScope', 'keyHash'], { unique: true })
export class IdempotencyRecordEntity extends TenantOwnedEntity {
  @Column('text', { name: 'endpoint_scope' })
  public endpointScope!: string;

  @Column('text', { name: 'key_hash' })
  public keyHash!: string;

  @Column('text', { name: 'request_fingerprint' })
  public requestFingerprint!: string;

  @Column('uuid', { name: 'principal_id' })
  public principalId!: string;

  @Column('text', { name: 'principal_kind' })
  public principalKind!: PrincipalKind;

  @Column('text', { default: 'processing' })
  public status!: 'processing' | 'completed';

  @Column('integer', { name: 'response_status', nullable: true })
  public responseStatus!: number | null;

  @Column('jsonb', { name: 'response_body', nullable: true })
  public responseBody!: JsonObject | null;

  @Column('timestamptz', { name: 'expires_at' })
  public expiresAt!: Date;
}

@Entity({ name: 'dead_letters' })
@Index(['tenantId', 'status', 'createdAt'])
export class DeadLetterEntity extends TenantOwnedEntity {
  @Column('text', { name: 'resource_kind' })
  public resourceKind!: 'request' | 'webhook' | 'notification' | 'outbox';

  @Column('uuid', { name: 'resource_id' })
  public resourceId!: string;

  @Column('text')
  public status!: 'open' | 'requeued' | 'resolved';

  @Column('text', { name: 'reason_code' })
  public reasonCode!: string;

  @Column('text', { name: 'reason_message' })
  public reasonMessage!: string;

  @Column('integer', { name: 'attempt_count' })
  public attemptCount!: number;

  @Column('uuid', { name: 'requeued_by_principal_id', nullable: true })
  public requeuedByPrincipalId!: string | null;

  @Column('timestamptz', { name: 'requeued_at', nullable: true })
  public requeuedAt!: Date | null;
}

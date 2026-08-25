import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { JsonObject, PrincipalKind, WorkflowRequestStatus } from '@queueforge/contracts';
import { assertRequestTransition, terminalRequestStatuses } from '@queueforge/domain';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';
import { appendAuditEvent } from './audit.store.js';
import { appendOutboxEvent } from './outbox.store.js';
import { insertProcessedEvent } from './processed-event.store.js';

interface LockedRequestRow {
  id: string;
  status: WorkflowRequestStatus;
  attempt_count: number;
  attempt_sequence: number;
  max_attempts: number;
  correlation_id: string;
  status_changed_at: Date;
  workflow_version_id: string;
  processing_config: JsonObject;
  processor_config: JsonObject;
}

export interface BeginRequestAttemptResult {
  readonly attemptNo: number;
  readonly budgetAttemptNo: number;
  readonly startedAt: Date;
  readonly correlationId: string;
  readonly processingConfig: JsonObject;
  readonly processorConfig: JsonObject;
}

export interface CompleteRequestInput {
  readonly requestId: string;
  readonly attemptNo: number;
  readonly workerId: string;
  readonly startedAt: Date;
  readonly correlationId: string;
}

export interface FailRequestInput extends CompleteRequestInput {
  readonly errorCode: string;
  readonly errorMessage: string;
}

export interface TerminalReceiptInput {
  readonly eventId: string;
  readonly consumer: string;
}

async function lockRequest(
  manager: EntityManager,
  tenantId: string,
  requestId: string,
): Promise<LockedRequestRow> {
  const rows = (await manager.query(
    `SELECT request.id, request.status, request.attempt_count, request.attempt_sequence,
            request.max_attempts,
            request.correlation_id, request.status_changed_at, request.workflow_version_id,
            version.processing_config,
            processor.config AS processor_config
     FROM workflow_requests request
     JOIN workflow_versions version
       ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
     JOIN LATERAL (
       SELECT target.config
       FROM workflow_targets target
       WHERE target.tenant_id = request.tenant_id
         AND target.workflow_version_id = request.workflow_version_id
         AND target.target_kind = 'processor'
       ORDER BY target.position, target.id
       LIMIT 1
     ) processor ON true
     WHERE request.tenant_id = $1 AND request.id = $2
     FOR UPDATE OF request`,
    [tenantId, requestId],
  )) as unknown as LockedRequestRow[];
  const request = rows[0];
  if (request === undefined) {
    throw new PersistenceNotFoundError('workflow request');
  }
  return request;
}

async function insertTransition(
  manager: EntityManager,
  tenantId: string,
  requestId: string,
  from: WorkflowRequestStatus,
  to: WorkflowRequestStatus,
  reason: string,
  actorPrincipalKind: PrincipalKind = 'system',
  actorPrincipalId: string | null = null,
  safeMetadata: JsonObject = {},
): Promise<void> {
  await manager.query(
    `INSERT INTO request_transitions
       (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
        actor_principal_kind, reason, safe_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      tenantId,
      randomUUID(),
      requestId,
      from,
      to,
      actorPrincipalId,
      actorPrincipalKind,
      reason,
      JSON.stringify(safeMetadata),
    ],
  );
}

async function completeSucceededInTransaction(
  manager: EntityManager,
  scope: TenantScope,
  tenantId: string,
  input: CompleteRequestInput,
): Promise<void> {
  const request = await lockRequest(manager, tenantId, input.requestId);
  if (request.attempt_sequence !== input.attemptNo) {
    throw new PersistenceConflictError('STALE_ATTEMPT', 'Worker attempt is stale');
  }
  assertRequestTransition(request.status, 'succeeded');
  const finishedAt = new Date();
  await manager.query(
    `INSERT INTO request_attempts
       (tenant_id, id, request_id, attempt_no, outcome, worker_id, started_at, finished_at)
     VALUES ($1, $2, $3, $4, 'succeeded', $5, $6, $7)`,
    [
      tenantId,
      randomUUID(),
      input.requestId,
      input.attemptNo,
      input.workerId,
      input.startedAt,
      finishedAt,
    ],
  );
  await manager.query(
    `UPDATE workflow_requests
     SET status = 'succeeded', status_changed_at = $3, updated_at = $3
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, input.requestId, finishedAt],
  );
  await insertTransition(
    manager,
    tenantId,
    input.requestId,
    'processing',
    'succeeded',
    'worker_completed',
    'system',
    null,
    {
      attemptNo: input.attemptNo,
      budgetAttemptNo: request.attempt_count,
      workerId: input.workerId,
    },
  );
  const targets = (await manager.query(
    `SELECT target_kind, config FROM workflow_targets
     WHERE tenant_id = $1 AND workflow_version_id = $2
     ORDER BY position, id`,
    [tenantId, request.workflow_version_id],
  )) as unknown as Array<{
    target_kind: 'processor' | 'webhook' | 'notification';
    config: JsonObject;
  }>;
  let webhookDeliveries = 0;
  let notifications = 0;
  for (const target of targets) {
    if (target.target_kind === 'webhook') {
      const endpointId = target.config.endpointId;
      if (typeof endpointId !== 'string') {
        throw new PersistenceConflictError(
          'WORKFLOW_TARGET_INVALID',
          'Webhook target is missing endpointId',
        );
      }
      const endpoints = (await manager.query(
        `SELECT endpoint.url, secret.key_id
         FROM webhook_endpoints endpoint
         JOIN webhook_secrets secret
           ON secret.tenant_id = endpoint.tenant_id AND secret.endpoint_id = endpoint.id
          AND secret.status = 'active'
         WHERE endpoint.tenant_id = $1 AND endpoint.id = $2 AND endpoint.is_enabled
         FOR SHARE OF endpoint, secret`,
        [tenantId, endpointId],
      )) as unknown as Array<{ url: string; key_id: string }>;
      const endpoint = endpoints[0];
      if (endpoint === undefined) {
        throw new PersistenceConflictError(
          'WORKFLOW_TARGET_UNAVAILABLE',
          'Enabled webhook endpoint with an active key is required',
        );
      }
      const deliveryId = randomUUID();
      const eventId = randomUUID();
      const payload: JsonObject = {
        schemaVersion: 1,
        eventId,
        tenantId,
        eventType: 'request.succeeded',
        aggregateType: 'workflow_request',
        aggregateId: input.requestId,
        correlationId: input.correlationId,
        occurredAt: finishedAt.toISOString(),
        payload: {
          requestId: input.requestId,
          attemptNo: input.attemptNo,
          budgetAttemptNo: request.attempt_count,
        },
      };
      await manager.query(
        `INSERT INTO webhook_deliveries
           (tenant_id, id, endpoint_id, event_id, generation, target_url,
            payload_snapshot, key_id, status, attempt_count, max_attempts, next_attempt_at)
         VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, $7, 'pending', 0, 5, clock_timestamp())`,
        [
          tenantId,
          deliveryId,
          endpointId,
          eventId,
          endpoint.url,
          JSON.stringify(payload),
          endpoint.key_id,
        ],
      );
      await appendOutboxEvent(manager, scope, {
        eventType: 'webhook.delivery.requested',
        aggregateType: 'webhook_delivery',
        aggregateId: deliveryId,
        correlationId: input.correlationId,
        payload: { deliveryId, eventId, requestId: input.requestId },
      });
      webhookDeliveries += 1;
    } else if (target.target_kind === 'notification') {
      const recipientKind = target.config.recipientKind === 'user' ? 'user' : 'role';
      const configuredRecipient = target.config.recipientRef;
      const recipientRef =
        typeof configuredRecipient === 'string'
          ? configuredRecipient
          : recipientKind === 'role'
            ? 'operator'
            : null;
      if (recipientRef === null || recipientRef.length === 0) {
        throw new PersistenceConflictError(
          'WORKFLOW_TARGET_INVALID',
          'Notification target is missing recipientRef',
        );
      }
      const notificationId = randomUUID();
      const title =
        typeof target.config.title === 'string'
          ? target.config.title.slice(0, 200)
          : 'Workflow request completed';
      const body =
        typeof target.config.body === 'string'
          ? target.config.body.slice(0, 4_000)
          : `Request ${input.requestId} succeeded`;
      await manager.query(
        `INSERT INTO notifications
           (tenant_id, id, request_id, recipient_kind, recipient_ref, title, body, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [tenantId, notificationId, input.requestId, recipientKind, recipientRef, title, body],
      );
      await appendOutboxEvent(manager, scope, {
        eventType: 'notification.requested',
        aggregateType: 'notification',
        aggregateId: notificationId,
        correlationId: input.correlationId,
        payload: { notificationId, requestId: input.requestId },
      });
      notifications += 1;
    }
  }
  await appendAuditEvent(manager, scope, {
    eventType: 'request.succeeded',
    actorPrincipalId: null,
    actorPrincipalKind: 'system',
    resourceType: 'workflow_request',
    resourceId: input.requestId,
    correlationId: input.correlationId,
    metadata: {
      attemptNo: input.attemptNo,
      budgetAttemptNo: request.attempt_count,
      workerId: input.workerId,
      webhookDeliveries,
      notifications,
    },
  });
}

async function completeFailedInTransaction(
  manager: EntityManager,
  scope: TenantScope,
  tenantId: string,
  input: FailRequestInput,
): Promise<'queued' | 'dead_lettered'> {
  const request = await lockRequest(manager, tenantId, input.requestId);
  if (request.attempt_sequence !== input.attemptNo) {
    throw new PersistenceConflictError('STALE_ATTEMPT', 'Worker attempt is stale');
  }
  assertRequestTransition(request.status, 'failed');
  const exhausted = request.attempt_count >= request.max_attempts;
  const finalStatus: 'queued' | 'dead_lettered' = exhausted ? 'dead_lettered' : 'queued';
  const finishedAt = new Date();
  await manager.query(
    `INSERT INTO request_attempts
       (tenant_id, id, request_id, attempt_no, outcome, worker_id, started_at, finished_at,
        error_code, error_message)
     VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7, $8, left($9, 2000))`,
    [
      tenantId,
      randomUUID(),
      input.requestId,
      input.attemptNo,
      input.workerId,
      input.startedAt,
      finishedAt,
      input.errorCode,
      input.errorMessage,
    ],
  );
  await insertTransition(
    manager,
    tenantId,
    input.requestId,
    'processing',
    'failed',
    'worker_failed',
    'system',
    null,
    {
      attemptNo: input.attemptNo,
      budgetAttemptNo: request.attempt_count,
      errorCode: input.errorCode,
    },
  );
  assertRequestTransition('failed', finalStatus);
  await insertTransition(
    manager,
    tenantId,
    input.requestId,
    'failed',
    finalStatus,
    exhausted ? 'attempts_exhausted' : 'retry_scheduled',
    'system',
    null,
    { attemptNo: input.attemptNo, budgetAttemptNo: request.attempt_count },
  );
  await manager.query(
    `UPDATE workflow_requests
     SET status = $3, status_changed_at = $4, updated_at = $4,
         last_error_code = $5, last_error_message = left($6, 2000)
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, input.requestId, finalStatus, finishedAt, input.errorCode, input.errorMessage],
  );
  if (exhausted) {
    await manager.query(
      `INSERT INTO dead_letters
         (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
       VALUES ($1, gen_random_uuid(), 'request', $2, 'open', $3, left($4, 2000), $5)
       ON CONFLICT DO NOTHING`,
      [tenantId, input.requestId, input.errorCode, input.errorMessage, request.attempt_count],
    );
  }
  await appendAuditEvent(manager, scope, {
    eventType: exhausted ? 'request.dead_lettered' : 'request.retry_scheduled',
    actorPrincipalId: null,
    actorPrincipalKind: 'system',
    resourceType: 'workflow_request',
    resourceId: input.requestId,
    correlationId: input.correlationId,
    metadata: {
      attemptNo: input.attemptNo,
      budgetAttemptNo: request.attempt_count,
      errorCode: input.errorCode,
    },
  });
  await appendOutboxEvent(manager, scope, {
    eventType: exhausted ? 'request.dead_lettered' : 'request.failed',
    aggregateType: 'workflow_request',
    aggregateId: input.requestId,
    correlationId: input.correlationId,
    payload: {
      requestId: input.requestId,
      attemptNo: input.attemptNo,
      budgetAttemptNo: request.attempt_count,
      errorCode: input.errorCode,
    },
  });
  return finalStatus;
}

@Injectable()
export class RequestExecutionStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async beginAttempt(
    scope: TenantScope,
    requestId: string,
    workerId: string,
  ): Promise<BeginRequestAttemptResult> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      const request = await lockRequest(manager, tenantId, requestId);
      assertRequestTransition(request.status, 'processing');
      const budgetAttemptNo = request.attempt_count + 1;
      const attemptNo = request.attempt_sequence + 1;
      const startedAt = new Date();
      await manager.query(
        `UPDATE workflow_requests
         SET status = 'processing', attempt_count = $3, attempt_sequence = $4,
             status_changed_at = $5, updated_at = $5,
             last_error_code = NULL, last_error_message = NULL
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, requestId, budgetAttemptNo, attemptNo, startedAt],
      );
      await insertTransition(
        manager,
        tenantId,
        requestId,
        request.status,
        'processing',
        'worker_started',
        'system',
        null,
        { workerId, attemptNo, budgetAttemptNo },
      );
      return {
        attemptNo,
        budgetAttemptNo,
        startedAt,
        correlationId: request.correlation_id,
        processingConfig: request.processing_config,
        processorConfig: request.processor_config,
      };
    });
  }

  public async beginOrRecoverAttempt(
    scope: TenantScope,
    requestId: string,
    workerId: string,
    staleBefore: Date,
    terminalReceipt?: TerminalReceiptInput,
  ): Promise<
    BeginRequestAttemptResult | { readonly deadLettered: true } | { readonly duplicate: true }
  > {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      if (terminalReceipt !== undefined) {
        const existing = (await manager.query(
          `SELECT 1 FROM processed_events
           WHERE tenant_id = $1 AND consumer = $2 AND event_id = $3`,
          [tenantId, terminalReceipt.consumer, terminalReceipt.eventId],
        )) as unknown as Array<{ '?column?': number }>;
        if (existing.length > 0) {
          return { duplicate: true };
        }
      }
      let request = await lockRequest(manager, tenantId, requestId);
      if (request.status === 'processing') {
        if (request.status_changed_at > staleBefore) {
          throw new PersistenceConflictError(
            'ATTEMPT_STILL_ACTIVE',
            'The existing worker attempt has not exceeded its recovery threshold',
          );
        }
        const recoveredAt = new Date();
        assertRequestTransition('processing', 'failed');
        await manager.query(
          `INSERT INTO request_attempts
             (tenant_id, id, request_id, attempt_no, outcome, worker_id, started_at,
              finished_at, error_code, error_message)
           VALUES ($1, gen_random_uuid(), $2, $3, 'timed_out', $4, $5, $6,
                   'WORKER_LEASE_EXPIRED', 'worker attempt interrupted before completion')
           ON CONFLICT (tenant_id, request_id, attempt_no) DO NOTHING`,
          [
            tenantId,
            requestId,
            request.attempt_sequence,
            workerId,
            request.status_changed_at,
            recoveredAt,
          ],
        );
        await insertTransition(
          manager,
          tenantId,
          requestId,
          'processing',
          'failed',
          'worker_interrupted',
          'system',
          null,
          {
            recoveredBy: workerId,
            attemptNo: request.attempt_sequence,
            budgetAttemptNo: request.attempt_count,
          },
        );
        const exhausted = request.attempt_count >= request.max_attempts;
        const recoveryStatus: 'queued' | 'dead_lettered' = exhausted ? 'dead_lettered' : 'queued';
        assertRequestTransition('failed', recoveryStatus);
        await insertTransition(
          manager,
          tenantId,
          requestId,
          'failed',
          recoveryStatus,
          exhausted ? 'interrupted_attempts_exhausted' : 'interrupted_attempt_requeued',
          'system',
          null,
          {
            recoveredBy: workerId,
            attemptNo: request.attempt_sequence,
            budgetAttemptNo: request.attempt_count,
          },
        );
        await manager.query(
          `UPDATE workflow_requests
           SET status = $3, status_changed_at = $4, updated_at = $4,
               last_error_code = 'WORKER_LEASE_EXPIRED',
               last_error_message = 'worker attempt interrupted before completion'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, requestId, recoveryStatus, recoveredAt],
        );
        if (exhausted) {
          await manager.query(
            `INSERT INTO dead_letters
               (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
             VALUES ($1, gen_random_uuid(), 'request', $2, 'open', 'WORKER_LEASE_EXPIRED',
                     'worker attempt interrupted; attempts exhausted', $3)
             ON CONFLICT DO NOTHING`,
            [tenantId, requestId, request.attempt_count],
          );
          await appendAuditEvent(manager, scope, {
            eventType: 'request.dead_lettered',
            actorPrincipalId: null,
            actorPrincipalKind: 'system',
            resourceType: 'workflow_request',
            resourceId: requestId,
            correlationId: request.correlation_id,
            metadata: {
              reason: 'worker_interrupted',
              attemptNo: request.attempt_sequence,
              budgetAttemptNo: request.attempt_count,
            },
          });
          if (
            terminalReceipt !== undefined &&
            !(await insertProcessedEvent(
              manager,
              tenantId,
              terminalReceipt.consumer,
              terminalReceipt.eventId,
            ))
          ) {
            throw new PersistenceConflictError(
              'PROCESSED_EVENT_RACE',
              'Interrupted request event was completed concurrently',
            );
          }
          return { deadLettered: true };
        }
        request = { ...request, status: 'queued', status_changed_at: recoveredAt };
      }
      if (request.status !== 'queued') {
        if (!terminalRequestStatuses.includes(request.status)) {
          assertRequestTransition(request.status, 'processing');
        }
        if (
          terminalReceipt !== undefined &&
          !(await insertProcessedEvent(
            manager,
            tenantId,
            terminalReceipt.consumer,
            terminalReceipt.eventId,
          ))
        ) {
          throw new PersistenceConflictError(
            'PROCESSED_EVENT_RACE',
            'Terminal request event was completed concurrently',
          );
        }
        return { duplicate: true };
      }
      assertRequestTransition(request.status, 'processing');
      const budgetAttemptNo = request.attempt_count + 1;
      const attemptNo = request.attempt_sequence + 1;
      const startedAt = new Date();
      await manager.query(
        `UPDATE workflow_requests
         SET status = 'processing', attempt_count = $3, attempt_sequence = $4,
             status_changed_at = $5, updated_at = $5,
             last_error_code = NULL, last_error_message = NULL
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, requestId, budgetAttemptNo, attemptNo, startedAt],
      );
      await insertTransition(
        manager,
        tenantId,
        requestId,
        'queued',
        'processing',
        'worker_started_after_recovery_check',
        'system',
        null,
        { workerId, attemptNo, budgetAttemptNo },
      );
      return {
        attemptNo,
        budgetAttemptNo,
        startedAt,
        correlationId: request.correlation_id,
        processingConfig: request.processing_config,
        processorConfig: request.processor_config,
      };
    });
  }

  public async completeSucceeded(scope: TenantScope, input: CompleteRequestInput): Promise<void> {
    const tenantId = requireTenantId(scope);
    await this.dataSource.transaction(async (manager) => {
      await completeSucceededInTransaction(manager, scope, tenantId, input);
    });
  }

  public async completeSucceededOnce(
    scope: TenantScope,
    eventId: string,
    consumer: string,
    input: CompleteRequestInput,
  ): Promise<'processed' | 'duplicate'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      if (!(await insertProcessedEvent(manager, tenantId, consumer, eventId))) {
        return 'duplicate';
      }
      await completeSucceededInTransaction(manager, scope, tenantId, input);
      return 'processed';
    });
  }

  public async completeFailed(
    scope: TenantScope,
    input: FailRequestInput,
  ): Promise<'queued' | 'dead_lettered'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      return completeFailedInTransaction(manager, scope, tenantId, input);
    });
  }

  public async completeFailedOnce(
    scope: TenantScope,
    eventId: string,
    consumer: string,
    input: FailRequestInput,
  ): Promise<'queued' | 'dead_lettered' | 'duplicate'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      const existing = (await manager.query(
        `SELECT 1 FROM processed_events
         WHERE tenant_id = $1 AND consumer = $2 AND event_id = $3`,
        [tenantId, consumer, eventId],
      )) as unknown as Array<{ '?column?': number }>;
      if (existing.length > 0) {
        return 'duplicate';
      }
      const status = await completeFailedInTransaction(manager, scope, tenantId, input);
      if (
        status === 'dead_lettered' &&
        !(await insertProcessedEvent(manager, tenantId, consumer, eventId))
      ) {
        throw new PersistenceConflictError(
          'PROCESSED_EVENT_RACE',
          'Request event was completed concurrently',
        );
      }
      return status;
    });
  }
}

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { ApprovalDecisionInput, JsonObject, TenantContext } from '@queueforge/contracts';
import { assertRequestTransition } from '@queueforge/domain';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { withReadCommittedRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';
import { appendOutboxEvent } from './outbox.store.js';

interface ApprovalRow {
  id: string;
  request_id: string;
  workflow_version_id: string;
  payload_hash: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  revision: number;
  prevent_self_approval: boolean;
  requester_principal_id: string;
  request_status: string;
  correlation_id: string;
}

export interface ApprovalDecisionResult {
  readonly approvalId: string;
  readonly requestId: string;
  readonly decision: 'approved' | 'rejected';
  readonly requestStatus: 'queued' | 'rejected';
  readonly replayed: boolean;
}

export interface ApprovalIdempotencyInput {
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
}

interface ApprovalIdempotencyRow {
  principal_id: string;
  request_fingerprint: string;
  response_body: JsonObject | null;
  status: 'completed' | 'processing';
}

function decisionResultFromJson(body: JsonObject): ApprovalDecisionResult {
  const { approvalId, decision, replayed, requestId, requestStatus } = body;
  if (
    typeof approvalId !== 'string' ||
    typeof requestId !== 'string' ||
    (decision !== 'approved' && decision !== 'rejected') ||
    (requestStatus !== 'queued' && requestStatus !== 'rejected') ||
    typeof replayed !== 'boolean'
  ) {
    throw new PersistenceConflictError(
      'IDEMPOTENCY_RESULT_INVALID',
      'Stored approval response is invalid',
    );
  }
  return { approvalId, decision, replayed: true, requestId, requestStatus };
}

async function acquireIdempotency(
  manager: EntityManager,
  context: TenantContext,
  input: ApprovalIdempotencyInput,
): Promise<ApprovalDecisionResult | null> {
  const endpointScope = 'approvals:decide';
  await deleteExpiredIdempotencyRecord(
    manager,
    context.tenantId,
    endpointScope,
    input.idempotencyKeyHash,
  );
  await manager.query(
    `INSERT INTO idempotency_records
       (tenant_id, id, endpoint_scope, key_hash, request_fingerprint,
        principal_id, principal_kind, status, expires_at)
     VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, 'processing',
             clock_timestamp() + interval '24 hours')
     ON CONFLICT (tenant_id, endpoint_scope, key_hash) DO NOTHING`,
    [
      context.tenantId,
      endpointScope,
      input.idempotencyKeyHash,
      input.requestFingerprint,
      context.principalId,
      context.principalKind,
    ],
  );
  const rows = (await manager.query(
    `SELECT request_fingerprint, principal_id, status, response_body
     FROM idempotency_records
     WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3
     FOR UPDATE`,
    [context.tenantId, endpointScope, input.idempotencyKeyHash],
  )) as unknown as ApprovalIdempotencyRow[];
  const record = rows[0];
  if (
    record === undefined ||
    record.principal_id !== context.principalId ||
    record.request_fingerprint !== input.requestFingerprint
  ) {
    throw new PersistenceConflictError(
      'IDEMPOTENCY_KEY_REUSE',
      'Idempotency key was already used for another approval decision',
    );
  }
  if (record.status === 'completed') {
    if (record.response_body === null) {
      throw new PersistenceConflictError(
        'IDEMPOTENCY_RESULT_INVALID',
        'Stored approval response is missing',
      );
    }
    return decisionResultFromJson(record.response_body);
  }
  return null;
}

async function completeIdempotency(
  manager: EntityManager,
  context: TenantContext,
  input: ApprovalIdempotencyInput | undefined,
  result: ApprovalDecisionResult,
): Promise<void> {
  if (input === undefined) {
    return;
  }
  await manager.query(
    `UPDATE idempotency_records
     SET status = 'completed', response_status = 200, response_body = $4::jsonb,
         updated_at = clock_timestamp()
     WHERE tenant_id = $1 AND endpoint_scope = 'approvals:decide' AND key_hash = $2
       AND request_fingerprint = $3`,
    [context.tenantId, input.idempotencyKeyHash, input.requestFingerprint, JSON.stringify(result)],
  );
}

@Injectable()
export class ApprovalStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async decide(
    context: TenantContext,
    approvalId: string,
    correlationId: string,
    input: ApprovalDecisionInput,
    idempotency?: ApprovalIdempotencyInput,
  ): Promise<ApprovalDecisionResult> {
    if (
      !(['approver', 'tenant_admin', 'platform_admin'] as const).includes(context.role as never)
    ) {
      throw new PersistenceConflictError('AUTHORIZATION_DENIED', 'Approval role is required');
    }
    return withReadCommittedRetry(this.dataSource, async (manager) => {
      if (idempotency !== undefined) {
        const replay = await acquireIdempotency(manager, context, idempotency);
        if (replay !== null) {
          return replay;
        }
      }
      const rows = (await manager.query(
        `SELECT task.id, task.request_id, task.workflow_version_id, task.payload_hash,
                task.status, task.revision, task.prevent_self_approval,
                task.requester_principal_id, request.status AS request_status,
                request.correlation_id
         FROM approval_tasks task
         JOIN workflow_requests request
           ON request.tenant_id = task.tenant_id AND request.id = task.request_id
         WHERE task.tenant_id = $1 AND task.id = $2
         FOR UPDATE OF task, request`,
        [context.tenantId, approvalId],
      )) as unknown as ApprovalRow[];
      const task = rows[0];
      if (task === undefined) {
        throw new PersistenceNotFoundError('approval task');
      }
      const decisions = (await manager.query(
        `SELECT decision, actor_principal_id, expected_revision, note FROM approval_decisions
         WHERE tenant_id = $1 AND approval_task_id = $2`,
        [context.tenantId, approvalId],
      )) as unknown as Array<{
        decision: 'approved' | 'rejected';
        actor_principal_id: string;
        expected_revision: number;
        note: string | null;
      }>;
      const existing = decisions[0];
      if (existing !== undefined) {
        if (
          existing.decision === input.decision &&
          existing.actor_principal_id === context.principalId &&
          existing.expected_revision === input.expectedRevision &&
          existing.note === (input.note ?? null)
        ) {
          const replay: ApprovalDecisionResult = {
            approvalId,
            requestId: task.request_id,
            decision: existing.decision,
            requestStatus: existing.decision === 'approved' ? 'queued' : 'rejected',
            replayed: true,
          };
          await completeIdempotency(manager, context, idempotency, replay);
          return replay;
        }
        if (existing.expected_revision !== input.expectedRevision) {
          throw new PersistenceConflictError('STALE_REVISION', 'Approval task has changed');
        }
        throw new PersistenceConflictError('CONFLICT', 'Approval was already decided');
      }
      if (task.status !== 'pending' || task.request_status !== 'pending_approval') {
        throw new PersistenceConflictError('CONFLICT', 'Approval is no longer pending');
      }
      if (task.revision !== input.expectedRevision) {
        throw new PersistenceConflictError('STALE_REVISION', 'Approval task has changed');
      }
      if (task.prevent_self_approval && task.requester_principal_id === context.principalId) {
        throw new PersistenceConflictError(
          'SELF_APPROVAL_FORBIDDEN',
          'The request submitter cannot approve this request',
        );
      }
      const decisionId = randomUUID();
      const decidedAt = new Date();
      assertRequestTransition('pending_approval', input.decision);
      await manager.query(
        `INSERT INTO approval_decisions
            (tenant_id, id, approval_task_id, request_id, workflow_version_id, payload_hash,
            decision, note, actor_principal_id, actor_principal_kind, decided_at, expected_revision)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          context.tenantId,
          decisionId,
          approvalId,
          task.request_id,
          task.workflow_version_id,
          task.payload_hash,
          input.decision,
          input.note ?? null,
          context.principalId,
          context.principalKind,
          decidedAt,
          input.expectedRevision,
        ],
      );
      await manager.query(
        `UPDATE approval_tasks
         SET status = $3, revision = revision + 1, decided_at = $4, updated_at = $4
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, approvalId, input.decision, decidedAt],
      );
      await manager.query(
        `UPDATE workflow_requests
         SET status = $3, status_changed_at = $4, updated_at = $4
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, task.request_id, input.decision, decidedAt],
      );
      await manager.query(
        `INSERT INTO request_transitions
           (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
            actor_principal_kind, reason)
         VALUES ($1, gen_random_uuid(), $2, 'pending_approval', $3, $4, $5, 'approval_decided')`,
        [
          context.tenantId,
          task.request_id,
          input.decision,
          context.principalId,
          context.principalKind,
        ],
      );
      let requestStatus: 'queued' | 'rejected' = 'rejected';
      if (input.decision === 'approved') {
        requestStatus = 'queued';
        assertRequestTransition('approved', 'queued');
        await manager.query(
          `UPDATE workflow_requests
           SET status = 'queued', status_changed_at = clock_timestamp(), updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, task.request_id],
        );
        await manager.query(
          `INSERT INTO request_transitions
             (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
              actor_principal_kind, reason)
           VALUES ($1, gen_random_uuid(), $2, 'approved', 'queued', $3, $4, 'approval_queued')`,
          [context.tenantId, task.request_id, context.principalId, context.principalKind],
        );
        await appendOutboxEvent(manager, context, {
          eventType: 'request.queued',
          aggregateType: 'workflow_request',
          aggregateId: task.request_id,
          correlationId: task.correlation_id,
          payload: { requestId: task.request_id, approvalId },
        });
      }
      await appendOutboxEvent(manager, context, {
        eventType: input.decision === 'approved' ? 'request.approved' : 'request.rejected',
        aggregateType: 'workflow_request',
        aggregateId: task.request_id,
        correlationId: task.correlation_id,
        payload: { requestId: task.request_id, approvalId, decision: input.decision },
      });
      const notificationId = randomUUID();
      await manager.query(
        `INSERT INTO notifications
           (tenant_id, id, request_id, recipient_kind, recipient_ref, title, body, status)
         VALUES ($1, $2, $3, 'user', $4, 'Approval decision recorded', $5, 'pending')`,
        [
          context.tenantId,
          notificationId,
          task.request_id,
          task.requester_principal_id,
          `Request ${input.decision}`,
        ],
      );
      await appendOutboxEvent(manager, context, {
        eventType: 'notification.requested',
        aggregateType: 'notification',
        aggregateId: notificationId,
        correlationId: task.correlation_id,
        payload: { notificationId, requestId: task.request_id },
      });
      await appendAuditEvent(manager, context, {
        eventType: `approval.${input.decision}`,
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'approval_task',
        resourceId: approvalId,
        correlationId,
        metadata: {
          requestId: task.request_id,
          workflowVersionId: task.workflow_version_id,
          payloadHash: task.payload_hash,
        },
      });
      const result: ApprovalDecisionResult = {
        approvalId,
        requestId: task.request_id,
        decision: input.decision,
        requestStatus,
        replayed: false,
      };
      await completeIdempotency(manager, context, idempotency, result);
      return result;
    });
  }
}

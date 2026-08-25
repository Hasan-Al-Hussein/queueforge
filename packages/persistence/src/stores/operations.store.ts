import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  JsonObject,
  TenantContext,
  TenantRole,
  WorkflowRequestStatus,
  WorkflowRequestView,
} from '@queueforge/contracts';
import { assertRequestTransition } from '@queueforge/domain';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { withSerializableRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';
import { appendOutboxEvent } from './outbox.store.js';

export interface RequestCommandStoreInput {
  readonly correlationId: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
}

interface CommandRequestRow {
  id: string;
  workflow_template_id: string;
  workflow_version_id: string;
  workflow_name: string;
  version_no: number;
  status: WorkflowRequestStatus;
  source: WorkflowRequestView['source'];
  payload: JsonObject;
  correlation_id: string;
  submitted_at: Date;
  status_changed_at: Date;
  attempt_count: number;
  max_attempts: number;
}

function mapCommandRequest(row: CommandRequestRow): WorkflowRequestView {
  return {
    id: row.id,
    workflowId: row.workflow_template_id,
    workflowVersionId: row.workflow_version_id,
    workflowName: row.workflow_name,
    versionNo: row.version_no,
    status: row.status,
    source: row.source,
    payload: row.payload,
    correlationId: row.correlation_id,
    submittedAt: row.submitted_at.toISOString(),
    statusChangedAt: row.status_changed_at.toISOString(),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
  };
}

@Injectable()
export class OperationsStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async commandRequest(
    context: TenantContext,
    requestId: string,
    command: 'cancel' | 'retry',
    input: RequestCommandStoreInput,
  ): Promise<WorkflowRequestView> {
    return withSerializableRetry(this.dataSource, async (manager) => {
      const endpointScope = `requests:${requestId}:${command}`;
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
      const idempotencyRows = (await manager.query(
        `SELECT request_fingerprint, principal_id, status
         FROM idempotency_records
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3 FOR UPDATE`,
        [context.tenantId, endpointScope, input.idempotencyKeyHash],
      )) as unknown as Array<{
        request_fingerprint: string;
        principal_id: string;
        status: 'processing' | 'completed';
      }>;
      const idempotency = idempotencyRows[0];
      if (
        idempotency === undefined ||
        idempotency.request_fingerprint !== input.requestFingerprint ||
        idempotency.principal_id !== context.principalId
      ) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_KEY_REUSE',
          'Idempotency key was already used for another request command',
        );
      }
      const rows = (await manager.query(
        `SELECT request.id, request.workflow_template_id, request.workflow_version_id,
                version.name AS workflow_name, version.version_no, request.status,
                request.source, request.payload, request.correlation_id, request.submitted_at,
                request.status_changed_at, request.attempt_count, request.max_attempts
         FROM workflow_requests request
         JOIN workflow_versions version
           ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
         WHERE request.tenant_id = $1 AND request.id = $2
         FOR UPDATE OF request`,
        [context.tenantId, requestId],
      )) as unknown as CommandRequestRow[];
      let request = rows[0];
      if (request === undefined) {
        throw new PersistenceNotFoundError('workflow request');
      }
      const desired: WorkflowRequestStatus = command === 'cancel' ? 'cancelled' : 'queued';
      if (idempotency.status !== 'completed') {
        assertRequestTransition(request.status, desired, { manualRetry: command === 'retry' });
        const previousStatus = request.status;
        const changedAt = new Date();
        await manager.query(
          `UPDATE workflow_requests
           SET status = $3, status_changed_at = $4, updated_at = $4,
               attempt_count = CASE WHEN $3 = 'queued' THEN 0 ELSE attempt_count END,
               last_error_code = CASE WHEN $3 = 'queued' THEN NULL ELSE last_error_code END,
               last_error_message = CASE WHEN $3 = 'queued' THEN NULL ELSE last_error_message END
           WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, requestId, desired, changedAt],
        );
        await manager.query(
          `INSERT INTO request_transitions
             (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
              actor_principal_kind, reason)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7)`,
          [
            context.tenantId,
            requestId,
            previousStatus,
            desired,
            context.principalId,
            context.principalKind,
            command === 'cancel' ? 'manual_cancel' : 'manual_retry',
          ],
        );
        if (command === 'cancel') {
          await manager.query(
            `UPDATE approval_tasks
             SET status = 'cancelled', decided_at = clock_timestamp(), revision = revision + 1,
                 updated_at = clock_timestamp()
             WHERE tenant_id = $1 AND request_id = $2 AND status = 'pending'`,
            [context.tenantId, requestId],
          );
        } else {
          await manager.query(
            `UPDATE dead_letters
             SET status = 'requeued', requeued_by_principal_id = $3,
                 requeued_at = clock_timestamp(), updated_at = clock_timestamp()
             WHERE tenant_id = $1 AND resource_kind = 'request' AND resource_id = $2
               AND status = 'open'`,
            [context.tenantId, requestId, context.principalId],
          );
          await appendOutboxEvent(manager, context, {
            eventType: 'request.queued',
            aggregateType: 'workflow_request',
            aggregateId: requestId,
            correlationId: request.correlation_id,
            payload: { requestId, manualRetry: true },
          });
        }
        await appendAuditEvent(manager, context, {
          eventType: `request.${command === 'cancel' ? 'cancelled' : 'requeued'}`,
          actorPrincipalId: context.principalId,
          actorPrincipalKind: context.principalKind,
          resourceType: 'workflow_request',
          resourceId: requestId,
          correlationId: input.correlationId,
          metadata: { previousStatus, attemptBudgetReset: command === 'retry' },
        });
        await manager.query(
          `UPDATE idempotency_records
           SET status = 'completed', response_status = 200,
               response_body = jsonb_build_object('requestId', $4::text),
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
          [context.tenantId, endpointScope, input.idempotencyKeyHash, requestId],
        );
        request = {
          ...request,
          status: desired,
          status_changed_at: changedAt,
          attempt_count: command === 'retry' ? 0 : request.attempt_count,
        };
      }
      return mapCommandRequest(request);
    });
  }

  public async retryDeadLetter(
    context: TenantContext,
    deadLetterId: string,
    correlationId: string,
  ): Promise<{ readonly resourceKind: string; readonly resourceId: string }> {
    if (
      !(['operator', 'tenant_admin', 'platform_admin'] as const).includes(context.role as never)
    ) {
      throw new PersistenceConflictError('AUTHORIZATION_DENIED', 'Operator role is required');
    }
    return withSerializableRetry(this.dataSource, async (manager) => {
      const rows = (await manager.query(
        `SELECT resource_kind, resource_id, status FROM dead_letters
         WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [context.tenantId, deadLetterId],
      )) as unknown as Array<{ resource_kind: string; resource_id: string; status: string }>;
      const deadLetter = rows[0];
      if (deadLetter === undefined) {
        throw new PersistenceNotFoundError('dead letter');
      }
      if (deadLetter.status !== 'open') {
        throw new PersistenceConflictError('CONFLICT', 'Dead letter was already handled');
      }
      if (deadLetter.resource_kind === 'request') {
        const requests = (await manager.query(
          `SELECT status, correlation_id FROM workflow_requests
           WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [context.tenantId, deadLetter.resource_id],
        )) as unknown as Array<{ status: WorkflowRequestStatus; correlation_id: string }>;
        if (requests[0]?.status !== 'dead_lettered') {
          throw new PersistenceConflictError(
            'INVALID_STATE_TRANSITION',
            'Request is not dead-lettered',
          );
        }
        assertRequestTransition('dead_lettered', 'queued', { manualRetry: true });
        await manager.query(
          `UPDATE workflow_requests
           SET status = 'queued', status_changed_at = clock_timestamp(), updated_at = clock_timestamp(),
               attempt_count = 0,
               last_error_code = NULL, last_error_message = NULL
           WHERE tenant_id = $1 AND id = $2`,
          [context.tenantId, deadLetter.resource_id],
        );
        await manager.query(
          `INSERT INTO request_transitions
             (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
              actor_principal_kind, reason)
           VALUES ($1, gen_random_uuid(), $2, 'dead_lettered', 'queued', $3, $4, 'manual_retry')`,
          [context.tenantId, deadLetter.resource_id, context.principalId, context.principalKind],
        );
        await appendOutboxEvent(manager, context, {
          eventType: 'request.queued',
          aggregateType: 'workflow_request',
          aggregateId: deadLetter.resource_id,
          correlationId: requests[0].correlation_id,
          payload: { requestId: deadLetter.resource_id, manualRetry: true },
        });
      } else if (deadLetter.resource_kind === 'outbox') {
        await manager.query(
          `UPDATE outbox_events
           SET status = 'retry', attempt_count = 0, available_at = clock_timestamp(),
               lease_owner = NULL, lease_until = NULL, last_error = NULL, updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2 AND status = 'dead'`,
          [context.tenantId, deadLetter.resource_id],
        );
      } else {
        throw new PersistenceConflictError(
          'CONFLICT',
          `Use the dedicated ${deadLetter.resource_kind} replay action`,
        );
      }
      await manager.query(
        `UPDATE dead_letters SET status = 'requeued', requeued_by_principal_id = $3,
                requeued_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [context.tenantId, deadLetterId, context.principalId],
      );
      await appendAuditEvent(manager, context, {
        eventType: 'dead_letter.requeued',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'dead_letter',
        resourceId: deadLetterId,
        correlationId,
        metadata: {
          resourceKind: deadLetter.resource_kind,
          resourceId: deadLetter.resource_id,
          attemptBudgetReset: true,
        },
      });
      return { resourceKind: deadLetter.resource_kind, resourceId: deadLetter.resource_id };
    });
  }

  public async markNotificationRead(
    context: TenantContext,
    notificationId: string,
  ): Promise<JsonObject | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{
        body: string;
        created_at: Date;
        id: string;
        recipient_kind: 'role' | 'user';
        requestId: string | null;
        status: 'delivered' | 'failed' | 'pending';
        title: string;
        workflowName: string | null;
      }>(
        await manager.query(
          `SELECT notification.id, notification.title, notification.body, notification.status,
                  notification.recipient_kind, notification.created_at,
                  request.id AS "requestId", version.name AS "workflowName"
           FROM notifications notification
           LEFT JOIN workflow_requests request
             ON request.tenant_id = notification.tenant_id
            AND request.id = notification.request_id
           LEFT JOIN workflow_versions version
             ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
           WHERE notification.tenant_id = $1 AND notification.id = $2
             AND ((notification.recipient_kind = 'user' AND notification.recipient_ref = $3)
               OR (notification.recipient_kind = 'role' AND notification.recipient_ref = $4))
           FOR UPDATE OF notification`,
          [context.tenantId, notificationId, context.principalId, context.role],
        ),
      );
      const notification = rows[0];
      if (notification === undefined) {
        return null;
      }
      const requestedReadAt = new Date();
      let readAt = requestedReadAt;
      if (notification.recipient_kind === 'role') {
        const receipts = queryRows<{ read_at: Date }>(
          await manager.query(
            `INSERT INTO notification_reads (tenant_id, notification_id, user_id, read_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (tenant_id, notification_id, user_id)
           DO UPDATE SET read_at = notification_reads.read_at
           RETURNING read_at`,
            [context.tenantId, notificationId, context.principalId, requestedReadAt],
          ),
        );
        readAt = receipts[0]?.read_at ?? requestedReadAt;
      } else {
        const updated = queryRows<{ read_at: Date }>(
          await manager.query(
            `UPDATE notifications
             SET read_at = COALESCE(read_at, $3), updated_at = clock_timestamp()
             WHERE tenant_id = $1 AND id = $2 RETURNING read_at`,
            [context.tenantId, notificationId, requestedReadAt],
          ),
        );
        readAt = updated[0]?.read_at ?? requestedReadAt;
      }
      return {
        body: notification.body,
        createdAt: notification.created_at.toISOString(),
        id: notification.id,
        kind:
          notification.status === 'failed'
            ? 'error'
            : notification.status === 'delivered'
              ? 'success'
              : notification.title.toLowerCase().includes('approval')
                ? 'warning'
                : 'info',
        readAt: readAt.toISOString(),
        requestId: notification.requestId,
        title: notification.title,
        workflowName: notification.workflowName,
      };
    });
  }

  public async updateMembershipRole(
    context: TenantContext,
    userId: string,
    role: TenantRole,
    correlationId: string,
  ): Promise<JsonObject> {
    if (context.role !== 'tenant_admin' && context.role !== 'platform_admin') {
      throw new PersistenceConflictError(
        'AUTHORIZATION_DENIED',
        'Tenant administrator role is required',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      // Serialize all role changes for a tenant so two concurrent demotions cannot remove
      // the final active administrator after both observe the same pre-change count.
      await manager.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [context.tenantId]);
      const rows = queryRows<{
        isActive: boolean;
        role: TenantRole;
        roleLocked: boolean;
      }>(
        await manager.query(
          `SELECT role, is_active AS "isActive", role_locked AS "roleLocked"
           FROM memberships
           WHERE tenant_id = $1 AND user_id = $2
           FOR UPDATE`,
          [context.tenantId, userId],
        ),
      );
      const membership = rows[0];
      if (membership === undefined) {
        throw new PersistenceNotFoundError('membership');
      }
      if (context.principalKind === 'user' && context.principalId === userId) {
        throw new PersistenceConflictError('CONFLICT', 'Your own tenant role cannot be changed');
      }
      if (membership.roleLocked) {
        throw new PersistenceConflictError('CONFLICT', 'This membership role is locked');
      }
      if (membership.role === role) {
        throw new PersistenceConflictError('CONFLICT', 'Membership already has the requested role');
      }
      if (membership.isActive && membership.role === 'tenant_admin' && role !== 'tenant_admin') {
        const adminCounts = queryRows<{ count: number }>(
          await manager.query(
            `SELECT count(*)::integer AS count
             FROM memberships
             WHERE tenant_id = $1 AND role = 'tenant_admin' AND is_active`,
            [context.tenantId],
          ),
        );
        if ((adminCounts[0]?.count ?? 0) <= 1) {
          throw new PersistenceConflictError(
            'CONFLICT',
            'The final active tenant administrator cannot be demoted',
          );
        }
      }
      await manager.query(
        `UPDATE memberships SET role = $3, updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND user_id = $2`,
        [context.tenantId, userId, role],
      );
      await appendAuditEvent(manager, context, {
        eventType: 'membership.role_changed',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'membership',
        resourceId: userId,
        correlationId,
        metadata: { previousRole: membership.role, role },
      });
      const members = (await manager.query(
        `SELECT app_user.id, app_user.email, app_user.display_name AS "displayName",
                membership.role, membership.role_locked AS "roleLocked",
                CASE WHEN membership.is_active THEN 'active' ELSE 'disabled' END AS status,
                membership.created_at AS "joinedAt"
         FROM memberships membership
         JOIN users app_user ON app_user.id = membership.user_id
         WHERE membership.tenant_id = $1 AND membership.user_id = $2`,
        [context.tenantId, userId],
      )) as unknown as JsonObject[];
      const member = members[0];
      if (member === undefined) {
        throw new PersistenceNotFoundError('membership');
      }
      return member;
    });
  }
}

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type {
  JsonObject,
  RequestSource,
  TenantContext,
  WorkflowRequestStatus,
  WorkflowRequestView,
} from '@queueforge/contracts';
import { assertRequestTransition, validatePayload } from '@queueforge/domain';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { withReadCommittedRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';
import { appendOutboxEvent } from './outbox.store.js';

interface ActiveWorkflowRow {
  template_id: string;
  template_name: string;
  version_id: string;
  version_no: number;
  request_schema: JsonObject;
  requires_approval: boolean;
  prevent_self_approval: boolean;
  processing_config: JsonObject;
}

interface IdempotencyRow {
  request_fingerprint: string;
  principal_id: string;
  status: 'processing' | 'completed';
  response_status: number | null;
  response_body: JsonObject | null;
}

export interface SubmitRequestStoreInput {
  readonly context: TenantContext;
  readonly workflowKey: string;
  readonly payload: JsonObject;
  readonly payloadHash: string;
  readonly source: RequestSource;
  readonly correlationId: string;
  readonly endpointScope: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  readonly maxAttempts?: number;
}

export interface SubmitRequestStoreResult {
  readonly statusCode: number;
  readonly body: JsonObject;
  readonly replayed: boolean;
}

export interface SubmitInboundWebhookStoreInput extends SubmitRequestStoreInput {
  readonly endpointId: string;
  readonly externalEventId: string;
  readonly nonce: string;
  readonly nonceExpiresAt: Date;
  readonly signatureKeyId: string;
}

export interface InboundWebhookReceiptRecord {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly eventId: string;
  readonly requestId: string;
}

interface InboundWebhookReceiptRow {
  external_event_id: string;
  idempotency_key_hash: string;
  payload_hash: string;
  request_id: string | null;
  signature_key_id: string;
}

function replayInboundReceipt(
  existing: InboundWebhookReceiptRow,
  input: SubmitInboundWebhookStoreInput,
): InboundWebhookReceiptRecord {
  if (
    existing.external_event_id !== input.externalEventId ||
    existing.idempotency_key_hash !== input.idempotencyKeyHash ||
    existing.payload_hash !== input.payloadHash ||
    existing.signature_key_id !== input.signatureKeyId ||
    existing.request_id === null ||
    existing.request_id.length === 0
  ) {
    throw new PersistenceConflictError(
      'IDEMPOTENCY_KEY_REUSE',
      'Inbound webhook identity was already used for different content',
    );
  }
  return {
    accepted: true,
    duplicate: true,
    eventId: existing.external_event_id,
    requestId: existing.request_id,
  };
}

async function insertRequestTransition(
  manager: EntityManager,
  input: {
    tenantId: string;
    requestId: string;
    from: WorkflowRequestStatus | null;
    to: WorkflowRequestStatus;
    context: TenantContext;
    reason: string;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO request_transitions
       (tenant_id, id, request_id, from_status, to_status, actor_principal_id,
        actor_principal_kind, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.tenantId,
      randomUUID(),
      input.requestId,
      input.from,
      input.to,
      input.context.principalId,
      input.context.principalKind,
      input.reason,
    ],
  );
}

@Injectable()
export class RequestSubmissionStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async submit(input: SubmitRequestStoreInput): Promise<SubmitRequestStoreResult> {
    return withReadCommittedRetry(this.dataSource, (manager) =>
      this.submitInTransaction(manager, input),
    );
  }

  public async submitInboundWebhook(
    input: SubmitInboundWebhookStoreInput,
  ): Promise<InboundWebhookReceiptRecord> {
    return withReadCommittedRetry(this.dataSource, async (manager) => {
      const tenantId = input.context.tenantId;
      const endpointLocks = queryRows<{ id: string }>(
        await manager.query(
          `SELECT id
           FROM webhook_endpoints
           WHERE tenant_id = $1 AND id = $2
           FOR UPDATE`,
          [tenantId, input.endpointId],
        ),
      );
      if (endpointLocks.length === 0) {
        throw new PersistenceNotFoundError('webhook endpoint');
      }
      await manager.query(
        `DELETE FROM inbound_webhook_replay_keys
         WHERE tenant_id = $1 AND endpoint_id = $2 AND expires_at <= clock_timestamp()`,
        [tenantId, input.endpointId],
      );
      const nonceRows = queryRows<{ nonce: string }>(
        await manager.query(
          `INSERT INTO inbound_webhook_replay_keys
           (tenant_id, endpoint_id, nonce, expires_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, endpoint_id, nonce) DO NOTHING
         RETURNING nonce`,
          [tenantId, input.endpointId, input.nonce, input.nonceExpiresAt],
        ),
      );
      if (nonceRows.length === 0) {
        throw new PersistenceConflictError(
          'WEBHOOK_REPLAY_DETECTED',
          'Inbound webhook nonce was already used',
        );
      }
      const receipts = (await manager.query(
        `SELECT external_event_id, idempotency_key_hash, payload_hash, request_id,
                signature_key_id
         FROM inbound_webhook_receipts
         WHERE tenant_id = $1 AND endpoint_id = $2
           AND (external_event_id = $3 OR idempotency_key_hash = $4)`,
        [tenantId, input.endpointId, input.externalEventId, input.idempotencyKeyHash],
      )) as unknown as InboundWebhookReceiptRow[];
      const existing = receipts[0];
      if (existing !== undefined) {
        return replayInboundReceipt(existing, input);
      }
      const submission = await this.submitInTransaction(manager, input);
      const request = submission.body.request;
      const requestId =
        request !== undefined &&
        request !== null &&
        typeof request === 'object' &&
        !Array.isArray(request) &&
        'id' in request &&
        typeof request.id === 'string'
          ? request.id
          : null;
      if (requestId === null || requestId.length === 0) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_RESULT_INVALID',
          'Inbound webhook request result is incomplete',
        );
      }
      const insertedReceipts = queryRows<InboundWebhookReceiptRow>(
        await manager.query(
          `INSERT INTO inbound_webhook_receipts
            (tenant_id, id, endpoint_id, external_event_id, idempotency_key_hash,
             payload_hash, request_id, signature_key_id)
          VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7)
          ON CONFLICT DO NOTHING
          RETURNING external_event_id, idempotency_key_hash, payload_hash, request_id,
                    signature_key_id`,
          [
            tenantId,
            input.endpointId,
            input.externalEventId,
            input.idempotencyKeyHash,
            input.payloadHash,
            requestId,
            input.signatureKeyId,
          ],
        ),
      );
      if (insertedReceipts.length === 0) {
        const concurrentReceipts = (await manager.query(
          `SELECT external_event_id, idempotency_key_hash, payload_hash, request_id,
                  signature_key_id
           FROM inbound_webhook_receipts
           WHERE tenant_id = $1 AND endpoint_id = $2
             AND (external_event_id = $3 OR idempotency_key_hash = $4)`,
          [tenantId, input.endpointId, input.externalEventId, input.idempotencyKeyHash],
        )) as unknown as InboundWebhookReceiptRow[];
        const concurrent = concurrentReceipts[0];
        if (concurrent === undefined) {
          throw new PersistenceConflictError(
            'IDEMPOTENCY_LOCK_FAILED',
            'Inbound webhook receipt unavailable after concurrent intake',
          );
        }
        return replayInboundReceipt(concurrent, input);
      }
      return {
        accepted: true,
        duplicate: submission.replayed,
        eventId: input.externalEventId,
        requestId,
      };
    });
  }

  private async submitInTransaction(
    manager: EntityManager,
    input: SubmitRequestStoreInput,
  ): Promise<SubmitRequestStoreResult> {
    const tenantId = input.context.tenantId;
    await deleteExpiredIdempotencyRecord(
      manager,
      tenantId,
      input.endpointScope,
      input.idempotencyKeyHash,
    );
    await manager.query(
      `INSERT INTO idempotency_records
           (tenant_id, id, endpoint_scope, key_hash, request_fingerprint,
            principal_id, principal_kind, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'processing', clock_timestamp() + interval '24 hours')
         ON CONFLICT (tenant_id, endpoint_scope, key_hash) DO NOTHING`,
      [
        tenantId,
        randomUUID(),
        input.endpointScope,
        input.idempotencyKeyHash,
        input.requestFingerprint,
        input.context.principalId,
        input.context.principalKind,
      ],
    );
    const idempotencyRows = (await manager.query(
      `SELECT request_fingerprint, principal_id, status, response_status, response_body
         FROM idempotency_records
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3
         FOR UPDATE`,
      [tenantId, input.endpointScope, input.idempotencyKeyHash],
    )) as unknown as IdempotencyRow[];
    const idempotency = idempotencyRows[0];
    if (idempotency === undefined) {
      throw new PersistenceConflictError(
        'IDEMPOTENCY_LOCK_FAILED',
        'Idempotency record unavailable',
      );
    }
    if (
      idempotency.request_fingerprint !== input.requestFingerprint ||
      idempotency.principal_id !== input.context.principalId
    ) {
      throw new PersistenceConflictError(
        'IDEMPOTENCY_KEY_REUSE',
        'Idempotency key was already used for a different request',
      );
    }
    if (idempotency.status === 'completed') {
      if (idempotency.response_status === null || idempotency.response_body === null) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_RESULT_INVALID',
          'Stored idempotency result is incomplete',
        );
      }
      return {
        statusCode: idempotency.response_status,
        body: idempotency.response_body,
        replayed: true,
      };
    }

    const workflows = (await manager.query(
      `SELECT template.id AS template_id, version.name AS template_name,
                 version.id AS version_id, version.version_no, version.request_schema,
                 version.requires_approval, version.prevent_self_approval,
                 version.processing_config
         FROM workflow_templates template
         JOIN workflow_versions version
           ON version.tenant_id = template.tenant_id AND version.template_id = template.id
         WHERE template.tenant_id = $1 AND template.stable_key = $2
           AND version.status = 'active' AND NOT template.is_archived AND template.is_enabled
         FOR SHARE OF template, version`,
      [tenantId, input.workflowKey],
    )) as unknown as ActiveWorkflowRow[];
    const workflow = workflows[0];
    if (workflow === undefined) {
      throw new PersistenceNotFoundError('active workflow');
    }
    const requestId = randomUUID();
    const now = new Date();
    const configuredMaxAttempts = input.maxAttempts ?? workflow.processing_config.maxAttempts;
    const maxAttempts =
      typeof configuredMaxAttempts === 'number' && Number.isInteger(configuredMaxAttempts)
        ? Math.min(25, Math.max(1, configuredMaxAttempts))
        : 5;
    await manager.query(
      `INSERT INTO workflow_requests
           (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
            payload, payload_hash, correlation_id, submitted_by_principal_id,
            submitted_by_principal_kind, attempt_count, max_attempts, submitted_at,
            status_changed_at)
         VALUES ($1, $2, $3, $4, 'received', $5, $6::jsonb, $7, $8, $9, $10, 0, $11, $12, $12)`,
      [
        tenantId,
        requestId,
        workflow.template_id,
        workflow.version_id,
        input.source,
        JSON.stringify(input.payload),
        input.payloadHash,
        input.correlationId,
        input.context.principalId,
        input.context.principalKind,
        maxAttempts,
        now,
      ],
    );
    await insertRequestTransition(manager, {
      tenantId,
      requestId,
      from: null,
      to: 'received',
      context: input.context,
      reason: 'request_received',
    });

    const validation = validatePayload(workflow.request_schema, input.payload);
    const status: WorkflowRequestStatus = !validation.valid
      ? 'validation_failed'
      : workflow.requires_approval
        ? 'pending_approval'
        : 'queued';
    assertRequestTransition('received', status);
    await manager.query(
      `UPDATE workflow_requests
         SET status = $3, status_changed_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
      [tenantId, requestId, status],
    );
    await insertRequestTransition(manager, {
      tenantId,
      requestId,
      from: 'received',
      to: status,
      context: input.context,
      reason: validation.valid
        ? workflow.requires_approval
          ? 'approval_required'
          : 'validated'
        : 'schema_validation_failed',
    });

    if (status === 'pending_approval') {
      const approvalId = randomUUID();
      await manager.query(
        `INSERT INTO approval_tasks
             (tenant_id, id, request_id, workflow_version_id, payload_hash, status,
              revision, prevent_self_approval, requester_principal_id, requester_principal_kind)
           VALUES ($1, $2, $3, $4, $5, 'pending', 1, $6, $7, $8)`,
        [
          tenantId,
          approvalId,
          requestId,
          workflow.version_id,
          input.payloadHash,
          workflow.prevent_self_approval,
          input.context.principalId,
          input.context.principalKind,
        ],
      );
      const notificationId = randomUUID();
      await manager.query(
        `INSERT INTO notifications
             (tenant_id, id, request_id, recipient_kind, recipient_ref, title, body, status)
           VALUES ($1, $2, $3, 'role', 'approver', 'Approval required', $4, 'pending')`,
        [tenantId, notificationId, requestId, `Review ${workflow.template_name}`],
      );
      await appendOutboxEvent(manager, input.context, {
        eventType: 'notification.requested',
        aggregateType: 'notification',
        aggregateId: notificationId,
        correlationId: input.correlationId,
        payload: { notificationId, requestId, approvalId },
      });
    } else if (status === 'queued') {
      await appendOutboxEvent(manager, input.context, {
        eventType: 'request.queued',
        aggregateType: 'workflow_request',
        aggregateId: requestId,
        correlationId: input.correlationId,
        payload: { requestId },
      });
    }

    await appendAuditEvent(manager, input.context, {
      eventType: `request.${status}`,
      actorPrincipalId: input.context.principalId,
      actorPrincipalKind: input.context.principalKind,
      resourceType: 'workflow_request',
      resourceId: requestId,
      correlationId: input.correlationId,
      metadata: validation.valid
        ? { workflowKey: input.workflowKey, source: input.source }
        : { validationErrorCount: validation.errors.length, workflowKey: input.workflowKey },
    });

    const view: WorkflowRequestView = {
      id: requestId,
      workflowId: workflow.template_id,
      workflowVersionId: workflow.version_id,
      workflowName: workflow.template_name,
      versionNo: workflow.version_no,
      status,
      source: input.source,
      payload: input.payload,
      correlationId: input.correlationId,
      submittedAt: now.toISOString(),
      statusChangedAt: now.toISOString(),
      attemptCount: 0,
      maxAttempts,
    };
    const body: JsonObject = {
      request: view,
      ...(validation.valid
        ? {}
        : {
            validationErrors: validation.errors.map((error) => ({
              path: error.instancePath,
              keyword: error.keyword,
              message: error.message ?? 'invalid value',
            })),
          }),
    };
    const statusCode = validation.valid ? 201 : 422;
    await manager.query(
      `UPDATE idempotency_records
         SET status = 'completed', response_status = $4, response_body = $5::jsonb,
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
      [tenantId, input.endpointScope, input.idempotencyKeyHash, statusCode, JSON.stringify(body)],
    );
    return { statusCode, body, replayed: false };
  }
}

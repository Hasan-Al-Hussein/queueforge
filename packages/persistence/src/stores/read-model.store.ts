import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type {
  JsonObject,
  TenantContext,
  WorkflowRequestStatus,
  WorkflowRequestView,
} from '@queueforge/contracts';

import { PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

interface RequestViewRow {
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

interface RequestCountRow {
  status: WorkflowRequestStatus;
  count: number;
}

interface QueueCountRow {
  queue_name: string;
  status: string;
  delayed: boolean;
  count: number;
}

interface WorkerNodeRow {
  heartbeat_at: Date;
  metadata: JsonObject;
}

interface QueueOverviewRow extends JsonObject {
  active: number;
  delayed: number;
  failed: number;
  heartbeatAt: string | null;
  name: string;
  outboxBacklog: number;
  outboxDead: number;
  paused: boolean;
  telemetryAvailable: boolean;
  waiting: number;
  workerCount: number;
  workerState: 'draining' | 'offline' | 'running' | 'unavailable';
}

interface ThroughputRow {
  bucket: Date;
  succeeded: number;
  failed: number;
}

interface ApprovalDetailRow {
  id: string;
  status: string;
  revision: number;
  requestedBy: string;
  decidedBy: string | null;
  note: string | null;
}

interface RequestTransitionRow {
  actorName: string | null;
  fromStatus: WorkflowRequestStatus | null;
  id: string;
  occurredAt: Date;
  reason: string | null;
  toStatus: WorkflowRequestStatus;
}

interface AuditViewRow {
  actorName: string | null;
  correlationId: string;
  eventType: string;
  id: string;
  occurredAt: Date;
  resourceId: string | null;
  resourceType: string;
  summary: string;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function toJsonRecord(row: Readonly<Record<string, unknown>>): JsonObject {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value instanceof Date ? value.toISOString() : value,
    ]),
  );
}

function mapRequest(row: RequestViewRow): WorkflowRequestView {
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
export class ReadModelStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async ping(): Promise<void> {
    await this.dataSource.query('SELECT 1');
  }

  private async listJsonPage(
    selectSql: string,
    countSql: string,
    parameters: readonly unknown[],
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const [items, counts] = await Promise.all([
      this.dataSource
        .query(`${selectSql}\nLIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`, [
          ...parameters,
          pageSize,
          (page - 1) * pageSize,
        ])
        .then(queryRows<Record<string, unknown>>),
      this.dataSource.query(countSql, [...parameters]).then(queryRows<{ count: number }>),
    ]);
    const totalItems = counts[0]?.count ?? 0;
    return {
      items: items.map(toJsonRecord),
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    };
  }

  public async dashboard(context: TenantContext): Promise<JsonObject> {
    const [requestCounts, outboxCounts, recent, throughput] = await Promise.all([
      this.dataSource
        .query(
          `SELECT status, count(*)::integer AS count FROM workflow_requests
         WHERE tenant_id = $1 GROUP BY status ORDER BY status`,
          [context.tenantId],
        )
        .then(queryRows<RequestCountRow>),
      this.loadOutboxCounts(context.tenantId),
      this.dataSource
        .query(
          `SELECT request.id, request.workflow_template_id, request.workflow_version_id,
                version.name AS workflow_name, version.version_no, request.status,
                request.source, request.payload, request.correlation_id, request.submitted_at,
                request.status_changed_at, request.attempt_count, request.max_attempts
         FROM workflow_requests request
         JOIN workflow_versions version
           ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
         WHERE request.tenant_id = $1
         ORDER BY request.submitted_at DESC, request.id DESC LIMIT 8`,
          [context.tenantId],
        )
        .then(queryRows<RequestViewRow>),
      this.dataSource
        .query(
          `SELECT date_trunc('hour', status_changed_at) AS bucket,
                count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
                count(*) FILTER (WHERE status IN ('failed','dead_lettered'))::integer AS failed
         FROM workflow_requests
         WHERE tenant_id = $1 AND status_changed_at >= clock_timestamp() - interval '24 hours'
         GROUP BY bucket ORDER BY bucket`,
          [context.tenantId],
        )
        .then(queryRows<ThroughputRow>),
    ]);
    return {
      statusCounts: requestCounts,
      queues: ['queueforge.requests', 'queueforge.webhooks', 'queueforge.notifications'].map(
        (name) => {
          const rows = outboxCounts.filter((row) => row.queue_name === name);
          return {
            name,
            waiting: rows
              .filter((row) => ['pending', 'retry'].includes(row.status) && !row.delayed)
              .reduce((sum, row) => sum + row.count, 0),
            active: rows
              .filter((row) => row.status === 'publishing')
              .reduce((sum, row) => sum + row.count, 0),
            delayed: rows
              .filter((row) => row.status === 'retry' && row.delayed)
              .reduce((sum, row) => sum + row.count, 0),
            failed: rows
              .filter((row) => row.status === 'dead')
              .reduce((sum, row) => sum + row.count, 0),
          };
        },
      ),
      recentRequests: recent.map(mapRequest),
      throughput: throughput.map((row) => ({
        bucket: row.bucket.toISOString(),
        succeeded: row.succeeded,
        failed: row.failed,
      })),
    };
  }

  public async listRequests(
    context: TenantContext,
    page: number,
    pageSize: number,
    status?: WorkflowRequestStatus,
    search?: string,
    sortBy: 'attemptCount' | 'source' | 'status' | 'submittedAt' | 'workflowName' = 'submittedAt',
    sortDirection: 'asc' | 'desc' = 'desc',
  ): Promise<PageResult<WorkflowRequestView>> {
    const offset = (page - 1) * pageSize;
    const sortExpression = {
      attemptCount: 'request.attempt_count',
      source: 'request.source',
      status: 'request.status',
      submittedAt: 'request.submitted_at',
      workflowName: 'version.name',
    }[sortBy];
    const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
    const filterSql = `request.tenant_id = $1
       AND ($2::text IS NULL OR request.status = $2)
       AND ($3::text IS NULL
         OR request.id::text ILIKE '%' || $3 || '%'
         OR version.name ILIKE '%' || $3 || '%'
         OR request.status ILIKE '%' || $3 || '%'
         OR request.source ILIKE '%' || $3 || '%')`;
    const [rows, counts] = await Promise.all([
      this.dataSource
        .query(
          `SELECT request.id, request.workflow_template_id, request.workflow_version_id,
              version.name AS workflow_name, version.version_no, request.status,
              request.source, request.payload, request.correlation_id, request.submitted_at,
              request.status_changed_at, request.attempt_count, request.max_attempts
       FROM workflow_requests request
       JOIN workflow_templates template
         ON template.tenant_id = request.tenant_id AND template.id = request.workflow_template_id
       JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       WHERE ${filterSql}
       ORDER BY ${sortExpression} ${direction}, request.submitted_at DESC, request.id DESC
       LIMIT $4 OFFSET $5`,
          [context.tenantId, status ?? null, search ?? null, pageSize, offset],
        )
        .then(queryRows<RequestViewRow>),
      this.dataSource
        .query(
          `SELECT count(*)::integer AS count
           FROM workflow_requests request
           JOIN workflow_versions version
             ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
           WHERE ${filterSql}`,
          [context.tenantId, status ?? null, search ?? null],
        )
        .then(queryRows<{ count: number }>),
    ]);
    const totalItems = counts[0]?.count ?? 0;
    return {
      items: rows.map(mapRequest),
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    };
  }

  public async getRequest(context: TenantContext, requestId: string): Promise<WorkflowRequestView> {
    const rows = queryRows<RequestViewRow>(
      await this.dataSource.query(
        `SELECT request.id, request.workflow_template_id, request.workflow_version_id,
              version.name AS workflow_name, version.version_no, request.status,
              request.source, request.payload, request.correlation_id, request.submitted_at,
              request.status_changed_at, request.attempt_count, request.max_attempts
       FROM workflow_requests request
       JOIN workflow_templates template
         ON template.tenant_id = request.tenant_id AND template.id = request.workflow_template_id
       JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       WHERE request.tenant_id = $1 AND request.id = $2`,
        [context.tenantId, requestId],
      ),
    );
    const request = rows[0];
    if (request === undefined) {
      throw new PersistenceNotFoundError('workflow request');
    }
    return mapRequest(request);
  }

  public async requestTimeline(
    context: TenantContext,
    requestId: string,
  ): Promise<readonly JsonObject[]> {
    await this.getRequest(context, requestId);
    const rows = queryRows<RequestTransitionRow>(
      await this.dataSource.query(
        `SELECT transition.id, transition.from_status AS "fromStatus",
              transition.to_status AS "toStatus", transition.reason,
              app_user.display_name AS "actorName", transition.occurred_at AS "occurredAt"
       FROM request_transitions transition
       LEFT JOIN users app_user ON app_user.id = transition.actor_principal_id
       WHERE transition.tenant_id = $1 AND transition.request_id = $2
       ORDER BY transition.occurred_at, transition.id`,
        [context.tenantId, requestId],
      ),
    );
    return rows.map((row) => ({
      actorName: row.actorName,
      fromStatus: row.fromStatus,
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      reason: row.reason,
      toStatus: row.toStatus,
    }));
  }

  public async requestDetail(context: TenantContext, requestId: string): Promise<JsonObject> {
    const request = await this.getRequest(context, requestId);
    const [transitions, approvalRows] = await Promise.all([
      this.requestTimeline(context, requestId),
      this.dataSource
        .query(
          `SELECT task.id, task.status, task.revision,
                COALESCE(requester.display_name, task.requester_principal_kind) AS "requestedBy",
                decider.display_name AS "decidedBy", decision.note
         FROM approval_tasks task
         LEFT JOIN users requester ON requester.id = task.requester_principal_id
         LEFT JOIN approval_decisions decision
           ON decision.tenant_id = task.tenant_id AND decision.approval_task_id = task.id
         LEFT JOIN users decider ON decider.id = decision.actor_principal_id
         WHERE task.tenant_id = $1 AND task.request_id = $2
         LIMIT 1`,
          [context.tenantId, requestId],
        )
        .then(queryRows<ApprovalDetailRow>),
    ]);
    const approval = approvalRows[0];
    return {
      request,
      transitions: [...transitions],
      approval:
        approval !== undefined && approval.status !== 'cancelled'
          ? {
              id: approval.id,
              status: approval.status,
              requestedBy: approval.requestedBy,
              decidedBy: approval.decidedBy,
              note: approval.note,
              revision: approval.revision,
            }
          : null,
    };
  }

  public listApprovals(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const fromSql = `FROM approval_tasks task
       JOIN workflow_requests request
         ON request.tenant_id = task.tenant_id AND request.id = task.request_id
       JOIN workflow_templates template
         ON template.tenant_id = request.tenant_id AND template.id = request.workflow_template_id
       JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       LEFT JOIN users app_user ON app_user.id = request.submitted_by_principal_id
       WHERE task.tenant_id = $1 AND task.status <> 'cancelled'`;
    return this.listJsonPage(
      `SELECT task.id, task.request_id AS "requestId", task.status, task.revision,
              task.created_at AS "createdAt", version.name AS "workflowName",
              request.submitted_by_principal_id AS "requestedById",
              COALESCE(app_user.display_name, request.submitted_by_principal_kind) AS "requestedByName",
              left(request.payload::text, 500) AS "payloadSummary"
       ${fromSql}
       ORDER BY CASE task.status WHEN 'pending' THEN 0 ELSE 1 END, task.created_at DESC, task.id DESC`,
      `SELECT count(*)::integer AS count ${fromSql}`,
      [context.tenantId],
      page,
      pageSize,
    );
  }

  public async listWebhookEndpoints(context: TenantContext): Promise<readonly JsonObject[]> {
    return queryRows<JsonObject>(
      await this.dataSource.query(
        `SELECT endpoint.id, endpoint.name, endpoint.url, endpoint.is_enabled AS active,
              secret.key_id AS "keyId", endpoint.updated_at AS "updatedAt"
       FROM webhook_endpoints endpoint
       LEFT JOIN webhook_secrets secret
         ON secret.tenant_id = endpoint.tenant_id AND secret.endpoint_id = endpoint.id
        AND secret.status = 'active'
       WHERE endpoint.tenant_id = $1 ORDER BY endpoint.name, endpoint.id`,
        [context.tenantId],
      ),
    );
  }

  public listWebhookDeliveries(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const fromSql = `FROM webhook_deliveries delivery
       JOIN webhook_endpoints endpoint
         ON endpoint.tenant_id = delivery.tenant_id AND endpoint.id = delivery.endpoint_id
       LEFT JOIN workflow_requests request
         ON request.tenant_id = delivery.tenant_id
        AND request.id::text = delivery.payload_snapshot->>'aggregateId'
       LEFT JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       WHERE delivery.tenant_id = $1`;
    return this.listJsonPage(
      `SELECT delivery.id, endpoint.name AS "endpointName",
              delivery.payload_snapshot->>'eventType' AS "eventType",
              delivery.event_id AS "eventId", delivery.status,
              request.id AS "requestId", version.name AS "workflowName",
              delivery.attempt_count AS "attemptCount",
              delivery.next_attempt_at AS "nextAttemptAt",
              (SELECT attempt.response_status
                 FROM webhook_delivery_attempts attempt
                WHERE attempt.tenant_id = delivery.tenant_id AND attempt.delivery_id = delivery.id
                ORDER BY attempt.attempt_no DESC LIMIT 1) AS "lastStatusCode",
              delivery.updated_at AS "updatedAt"
       ${fromSql}
       ORDER BY delivery.created_at DESC, delivery.id DESC`,
      `SELECT count(*)::integer AS count ${fromSql}`,
      [context.tenantId],
      page,
      pageSize,
    );
  }

  public async queueOverview(context: TenantContext): Promise<readonly JsonObject[]> {
    return this.loadQueueOverview(context.tenantId, context.role === 'platform_admin');
  }

  private async loadOutboxCounts(tenantId: string): Promise<readonly QueueCountRow[]> {
    return this.dataSource
      .query(
        `SELECT CASE
                WHEN event_type LIKE 'request.%' THEN 'queueforge.requests'
                WHEN event_type LIKE 'webhook.%' THEN 'queueforge.webhooks'
                WHEN event_type LIKE 'notification.%' THEN 'queueforge.notifications'
                ELSE 'queueforge.other'
              END AS queue_name,
              status, (available_at > clock_timestamp()) AS delayed,
              count(*)::integer AS count
         FROM outbox_events
         WHERE tenant_id = $1 AND status <> 'published'
         GROUP BY queue_name, status, delayed
         ORDER BY queue_name, status`,
        [tenantId],
      )
      .then(queryRows<QueueCountRow>);
  }

  private async loadQueueOverview(
    tenantId: string,
    includeGlobalTelemetry: boolean,
  ): Promise<readonly QueueOverviewRow[]> {
    const [outboxCounts, workers] = await Promise.all([
      this.loadOutboxCounts(tenantId),
      includeGlobalTelemetry
        ? this.dataSource
            .query(
              `SELECT heartbeat_at, metadata
               FROM worker_nodes
               WHERE service = 'queueforge-worker'
                 AND heartbeat_at >= clock_timestamp() - interval '45 seconds'
               ORDER BY heartbeat_at DESC`,
            )
            .then(queryRows<WorkerNodeRow>)
        : Promise.resolve([]),
    ]);
    const latestWorker = workers[0];
    const heartbeatAt = latestWorker?.heartbeat_at.toISOString() ?? null;
    const workerState = !includeGlobalTelemetry
      ? 'unavailable'
      : workers.some((worker) => worker.metadata.state === 'running')
        ? 'running'
        : workers.length > 0
          ? 'draining'
          : 'offline';
    const telemetry = Array.isArray(latestWorker?.metadata.queues)
      ? latestWorker.metadata.queues
      : [];
    const queueNames = [
      'queueforge.requests',
      'queueforge.webhooks',
      'queueforge.notifications',
    ] as const;
    return queueNames.map((name) => {
      const candidate = telemetry.find(
        (value): value is JsonObject => isJsonObject(value) && value.name === name,
      );
      const outbox = outboxCounts.filter((row) => row.queue_name === name);
      const count = (key: string): number => {
        const value = candidate?.[key];
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
      };
      return {
        name,
        waiting: count('waiting'),
        active: count('active'),
        delayed: count('delayed'),
        failed: count('failed'),
        paused: candidate?.paused === true,
        telemetryAvailable: includeGlobalTelemetry,
        workerState,
        workerCount: workers.length,
        heartbeatAt,
        outboxBacklog: outbox
          .filter((row) => ['pending', 'publishing', 'retry'].includes(row.status))
          .reduce((sum, row) => sum + row.count, 0),
        outboxDead: outbox
          .filter((row) => row.status === 'dead')
          .reduce((sum, row) => sum + row.count, 0),
      };
    });
  }

  public listDeadLetters(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const fromSql = `FROM dead_letters dead
       LEFT JOIN workflow_requests request
         ON request.tenant_id = dead.tenant_id AND request.id = dead.resource_id
       LEFT JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       WHERE dead.tenant_id = $1 AND dead.status = 'open' AND dead.resource_kind = 'request'`;
    return this.listJsonPage(
      `SELECT dead.id, dead.resource_id AS "requestId",
              COALESCE(version.name, initcap(dead.resource_kind) || ' resource') AS "workflowName",
              dead.reason_message AS reason, dead.attempt_count AS "attemptCount",
              dead.created_at AS "deadLetteredAt"
       ${fromSql}
       ORDER BY dead.created_at DESC, dead.id DESC`,
      `SELECT count(*)::integer AS count ${fromSql}`,
      [context.tenantId],
      page,
      pageSize,
    );
  }

  public listNotifications(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const fromSql = `FROM notifications notification
       LEFT JOIN notification_reads receipt
         ON receipt.tenant_id = notification.tenant_id
        AND receipt.notification_id = notification.id
        AND receipt.user_id = $2::uuid
       LEFT JOIN workflow_requests request
         ON request.tenant_id = notification.tenant_id AND request.id = notification.request_id
       LEFT JOIN workflow_versions version
         ON version.tenant_id = request.tenant_id AND version.id = request.workflow_version_id
       WHERE notification.tenant_id = $1
         AND ((notification.recipient_kind = 'user' AND notification.recipient_ref = $2::text)
           OR (notification.recipient_kind = 'role' AND notification.recipient_ref = $3))`;
    return this.listJsonPage(
      `SELECT notification.id, notification.title, notification.body,
               request.id AS "requestId", version.name AS "workflowName",
               CASE
                 WHEN notification.status = 'failed' THEN 'error'
                 WHEN notification.status = 'delivered' THEN 'success'
                 WHEN lower(notification.title) LIKE '%approval%' THEN 'warning'
                 ELSE 'info'
               END AS kind,
               CASE WHEN notification.recipient_kind = 'role'
                 THEN receipt.read_at ELSE notification.read_at END AS "readAt",
               notification.created_at AS "createdAt"
       ${fromSql}
       ORDER BY notification.created_at DESC, notification.id DESC`,
      `SELECT count(*)::integer AS count ${fromSql}`,
      [context.tenantId, context.principalId, context.role],
      page,
      pageSize,
    );
  }

  public listTeam(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): Promise<PageResult<JsonObject>> {
    const fromSql = `FROM memberships membership
       JOIN users app_user ON app_user.id = membership.user_id
       WHERE membership.tenant_id = $1`;
    return this.listJsonPage(
      `SELECT app_user.id, app_user.email, app_user.display_name AS "displayName",
              membership.role, membership.role_locked AS "roleLocked",
              CASE WHEN membership.is_active THEN 'active' ELSE 'disabled' END AS status,
              membership.created_at AS "joinedAt"
       ${fromSql}
       ORDER BY app_user.display_name, app_user.id`,
      `SELECT count(*)::integer AS count ${fromSql}`,
      [context.tenantId],
      page,
      pageSize,
    );
  }

  public async listAudit(
    context: TenantContext,
    page: number,
    pageSize: number,
    eventTypePrefix?: string,
  ): Promise<PageResult<JsonObject>> {
    const [rows, counts] = await Promise.all([
      this.dataSource
        .query(
          `SELECT audit.id, audit.event_type AS "eventType", app_user.display_name AS "actorName",
              audit.resource_type AS "resourceType", audit.resource_id AS "resourceId",
              left(audit.safe_metadata::text, 500) AS summary,
              audit.correlation_id AS "correlationId", audit.occurred_at AS "occurredAt"
       FROM audit_events audit
       LEFT JOIN users app_user ON app_user.id = audit.actor_principal_id
       WHERE audit.tenant_id = $1
         AND ($2::text IS NULL OR left(audit.event_type, length($2)) = $2)
       ORDER BY audit.occurred_at DESC, audit.id DESC
       LIMIT $3 OFFSET $4`,
          [context.tenantId, eventTypePrefix ?? null, pageSize, (page - 1) * pageSize],
        )
        .then(queryRows<AuditViewRow>),
      this.dataSource
        .query(
          `SELECT count(*)::integer AS count
           FROM audit_events audit
           WHERE audit.tenant_id = $1
             AND ($2::text IS NULL OR left(audit.event_type, length($2)) = $2)`,
          [context.tenantId, eventTypePrefix ?? null],
        )
        .then(queryRows<{ count: number }>),
    ]);
    const totalItems = counts[0]?.count ?? 0;
    return {
      items: rows.map((row) => ({
        actorName: row.actorName,
        correlationId: row.correlationId,
        eventType: row.eventType,
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        resourceId: row.resourceId,
        resourceType: row.resourceType,
        summary: row.summary,
      })),
      page,
      pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
    };
  }
}

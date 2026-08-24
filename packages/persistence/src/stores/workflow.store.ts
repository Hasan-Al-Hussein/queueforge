import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  WorkflowProcessingConfigSchema,
  WorkflowTargetsSchema,
  type DraftAutosaveInput,
  type JsonObject,
  type TenantContext,
  type WorkflowSummary,
  type WorkflowTargetInput,
} from '@queueforge/contracts';
import { hashJson, validatePayload } from '@queueforge/domain';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';
import { withSerializableRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';

interface WorkflowRow {
  id: string;
  stable_key: string;
  name: string;
  description: string | null;
  version_id: string;
  version_no: number;
  version_status: 'draft' | 'active' | 'retired';
  requires_approval: boolean;
  is_enabled: boolean;
  revision: number;
  updated_at: Date;
}

export interface WorkflowDraftRecord extends WorkflowSummary {
  readonly requestSchema: JsonObject;
  readonly preventSelfApproval: boolean;
  readonly processingConfig: JsonObject;
  readonly targets: readonly WorkflowTargetInput[];
}

export interface CreateWorkflowStoreInput {
  readonly stableKey: string;
  readonly name: string;
  readonly description: string | null;
  readonly correlationId: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
}

interface WorkflowDraftRow extends WorkflowRow {
  request_schema: JsonObject;
  prevent_self_approval: boolean;
  processing_config: JsonObject;
}

function assertValidRequestSchema(schema: JsonObject): void {
  try {
    validatePayload(schema, {});
  } catch {
    throw new PersistenceConflictError(
      'VALIDATION_FAILED',
      'Request schema is not a supported JSON Schema',
    );
  }
}

function mapWorkflow(row: WorkflowRow): WorkflowSummary {
  return {
    id: row.id,
    stableKey: row.stable_key,
    name: row.name,
    description: row.description,
    versionId: row.version_id,
    versionNo: row.version_no,
    versionStatus: row.version_status,
    requiresApproval: row.requires_approval,
    isEnabled: row.is_enabled,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadTargets(
  query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
  tenantId: string,
  workflowVersionId: string,
): Promise<readonly WorkflowTargetInput[]> {
  const rows = (await query(
    `SELECT target_kind, position, config
     FROM workflow_targets
     WHERE tenant_id = $1 AND workflow_version_id = $2
     ORDER BY position, id`,
    [tenantId, workflowVersionId],
  )) as Array<{
    target_kind: WorkflowTargetInput['targetKind'];
    position: number;
    config: JsonObject;
  }>;
  return rows.map((row) => ({
    targetKind: row.target_kind,
    position: row.position,
    config: row.config,
  }));
}

@Injectable()
export class WorkflowStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async create(
    context: TenantContext,
    input: CreateWorkflowStoreInput,
  ): Promise<WorkflowDraftRecord> {
    const tenantId = requireTenantId(context);
    return withSerializableRetry(this.dataSource, async (manager) => {
      const endpointScope = 'workflows:create';
      await deleteExpiredIdempotencyRecord(
        manager,
        tenantId,
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
          tenantId,
          endpointScope,
          input.idempotencyKeyHash,
          input.requestFingerprint,
          context.principalId,
          context.principalKind,
        ],
      );
      const idempotencyRows = (await manager.query(
        `SELECT request_fingerprint, principal_id, status, response_body
         FROM idempotency_records
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3
         FOR UPDATE`,
        [tenantId, endpointScope, input.idempotencyKeyHash],
      )) as unknown as Array<{
        request_fingerprint: string;
        principal_id: string;
        status: 'processing' | 'completed';
        response_body: JsonObject | null;
      }>;
      const idempotency = idempotencyRows[0];
      if (
        idempotency === undefined ||
        idempotency.request_fingerprint !== input.requestFingerprint ||
        idempotency.principal_id !== context.principalId
      ) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_KEY_REUSE',
          'Idempotency key was already used for another workflow',
        );
      }
      if (idempotency.status === 'completed') {
        const templateId = idempotency.response_body?.templateId;
        if (typeof templateId !== 'string') {
          throw new PersistenceConflictError(
            'IDEMPOTENCY_RESULT_INVALID',
            'Stored workflow result is incomplete',
          );
        }
        return this.getDraftWithManager(manager.query.bind(manager), tenantId, templateId);
      }
      const duplicate = (await manager.query(
        `SELECT 1 FROM workflow_templates WHERE tenant_id = $1 AND stable_key = $2 FOR SHARE`,
        [tenantId, input.stableKey],
      )) as unknown as Array<{ '?column?': number }>;
      if (duplicate.length > 0) {
        throw new PersistenceConflictError('CONFLICT', 'Workflow stable key is already in use');
      }
      const templateId = randomUUID();
      const versionId = randomUUID();
      await manager.query(
        `INSERT INTO workflow_templates
           (tenant_id, id, stable_key, name, description, is_enabled, created_by_principal_id)
         VALUES ($1, $2, $3, $4, $5, true, $6)`,
        [tenantId, templateId, input.stableKey, input.name, input.description, context.principalId],
      );
      await manager.query(
        `INSERT INTO workflow_versions
           (tenant_id, id, template_id, version_no, status, name, description, revision,
            request_schema, requires_approval, prevent_self_approval, processing_config,
            created_by_principal_id)
         VALUES ($1, $2, $3, 1, 'draft', $4, $5, 1,
                 '{"type":"object","additionalProperties":true}'::jsonb,
                 false, false,
                 '{"durationMs":250,"failuresBeforeSuccess":0,"maxAttempts":5}'::jsonb, $6)`,
        [tenantId, versionId, templateId, input.name, input.description, context.principalId],
      );
      await manager.query(
        `INSERT INTO workflow_targets
           (tenant_id, id, workflow_version_id, target_kind, position, config)
         VALUES ($1, gen_random_uuid(), $2, 'processor', 0, '{"handler":"demo"}'::jsonb)`,
        [tenantId, versionId],
      );
      await appendAuditEvent(manager, context, {
        eventType: 'workflow.created',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'workflow_template',
        resourceId: templateId,
        correlationId: input.correlationId,
        metadata: { stableKey: input.stableKey, workflowVersionId: versionId },
      });
      await manager.query(
        `UPDATE idempotency_records
         SET status = 'completed', response_status = 201,
             response_body = jsonb_build_object('templateId', $4::text),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
        [tenantId, endpointScope, input.idempotencyKeyHash, templateId],
      );
      return this.getDraftWithManager(manager.query.bind(manager), tenantId, templateId);
    });
  }

  private async getDraftWithManager(
    query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
    tenantId: string,
    templateId: string,
  ): Promise<WorkflowDraftRecord> {
    const rows = (await query(
      `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
              version.id AS version_id, version.version_no, version.status AS version_status,
              version.requires_approval, version.revision, version.request_schema,
              version.prevent_self_approval, version.processing_config, version.updated_at
       FROM workflow_templates template
       JOIN workflow_versions version
         ON version.tenant_id = template.tenant_id AND version.template_id = template.id
       WHERE template.tenant_id = $1 AND template.id = $2
         AND version.status IN ('draft','active')
       ORDER BY CASE version.status WHEN 'draft' THEN 0 ELSE 1 END, version.version_no DESC
       LIMIT 1`,
      [tenantId, templateId],
    )) as WorkflowDraftRow[];
    const draft = rows[0];
    if (draft === undefined) {
      throw new PersistenceNotFoundError('workflow draft');
    }
    return {
      ...mapWorkflow(draft),
      requestSchema: draft.request_schema,
      preventSelfApproval: draft.prevent_self_approval,
      processingConfig: draft.processing_config,
      targets: await loadTargets(query, tenantId, draft.version_id),
    };
  }

  public async list(scope: TenantScope): Promise<readonly WorkflowSummary[]> {
    const tenantId = requireTenantId(scope);
    const rows = (await this.dataSource.query(
      `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
              version.id AS version_id, version.version_no, version.status AS version_status,
              version.requires_approval, version.revision, version.updated_at
       FROM workflow_templates template
       JOIN LATERAL (
         SELECT candidate.* FROM workflow_versions candidate
         WHERE candidate.tenant_id = template.tenant_id AND candidate.template_id = template.id
         ORDER BY CASE candidate.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
                  candidate.version_no DESC
         LIMIT 1
       ) version ON true
       WHERE template.tenant_id = $1 AND NOT template.is_archived
       ORDER BY template.name, template.id`,
      [tenantId],
    )) as unknown as WorkflowRow[];
    return rows.map(mapWorkflow);
  }

  public async get(scope: TenantScope, templateId: string): Promise<WorkflowDraftRecord> {
    const tenantId = requireTenantId(scope);
    const rows = (await this.dataSource.query(
      `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
              version.id AS version_id, version.version_no, version.status AS version_status,
              version.requires_approval, version.revision, version.request_schema,
              version.prevent_self_approval, version.processing_config, version.updated_at
       FROM workflow_templates template
       JOIN LATERAL (
         SELECT candidate.* FROM workflow_versions candidate
         WHERE candidate.tenant_id = template.tenant_id AND candidate.template_id = template.id
           AND candidate.status IN ('draft','active')
         ORDER BY CASE candidate.status WHEN 'draft' THEN 0 ELSE 1 END, candidate.version_no DESC
         LIMIT 1
       ) version ON true
       WHERE template.tenant_id = $1 AND template.id = $2 AND NOT template.is_archived`,
      [tenantId, templateId],
    )) as unknown as WorkflowDraftRow[];
    const workflow = rows[0];
    if (workflow === undefined) {
      throw new PersistenceNotFoundError('workflow');
    }
    return {
      ...mapWorkflow(workflow),
      requestSchema: workflow.request_schema,
      preventSelfApproval: workflow.prevent_self_approval,
      processingConfig: workflow.processing_config,
      targets: await loadTargets(
        this.dataSource.query.bind(this.dataSource),
        tenantId,
        workflow.version_id,
      ),
    };
  }

  public async getOrCreateDraft(
    scope: TenantScope,
    templateId: string,
    actorPrincipalId: string,
  ): Promise<WorkflowDraftRecord> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      const templates = (await manager.query(
        `SELECT id, stable_key, name, description, is_enabled FROM workflow_templates
         WHERE tenant_id = $1 AND id = $2 AND NOT is_archived FOR UPDATE`,
        [tenantId, templateId],
      )) as unknown as Array<{
        id: string;
        stable_key: string;
        name: string;
        description: string | null;
        is_enabled: boolean;
      }>;
      const template = templates[0];
      if (template === undefined) {
        throw new PersistenceNotFoundError('workflow');
      }
      let versions = (await manager.query(
        `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
                version.id AS version_id, version.version_no, version.status AS version_status,
                version.requires_approval, version.revision, version.request_schema,
                version.prevent_self_approval, version.processing_config, version.updated_at
         FROM workflow_templates template
         JOIN workflow_versions version
           ON version.tenant_id = template.tenant_id AND version.template_id = template.id
         WHERE template.tenant_id = $1 AND template.id = $2 AND version.status = 'draft'
         LIMIT 1`,
        [tenantId, templateId],
      )) as unknown as WorkflowDraftRow[];
      if (versions.length === 0) {
        const active = (await manager.query(
          `SELECT * FROM workflow_versions
           WHERE tenant_id = $1 AND template_id = $2 AND status = 'active'
           ORDER BY version_no DESC LIMIT 1`,
          [tenantId, templateId],
        )) as unknown as Array<{
          id: string;
          version_no: number;
          name: string;
          description: string | null;
          request_schema: JsonObject;
          requires_approval: boolean;
          prevent_self_approval: boolean;
          processing_config: JsonObject;
        }>;
        const source = active[0];
        if (source === undefined) {
          throw new PersistenceNotFoundError('active workflow version');
        }
        const newDraftId = randomUUID();
        await manager.query(
          `INSERT INTO workflow_versions
             (tenant_id, id, template_id, version_no, status, name, description, revision,
              request_schema, requires_approval, prevent_self_approval, processing_config,
              created_by_principal_id)
           VALUES ($1, $2, $3, $4, 'draft', $5, $6, 1, $7::jsonb, $8, $9, $10::jsonb, $11)`,
          [
            tenantId,
            newDraftId,
            templateId,
            source.version_no + 1,
            source.name,
            source.description,
            JSON.stringify(source.request_schema),
            source.requires_approval,
            source.prevent_self_approval,
            JSON.stringify(source.processing_config),
            actorPrincipalId,
          ],
        );
        await manager.query(
          `INSERT INTO workflow_targets
             (tenant_id, id, workflow_version_id, target_kind, position, config)
           SELECT tenant_id, gen_random_uuid(), $3, target_kind, position, config
           FROM workflow_targets
           WHERE tenant_id = $1 AND workflow_version_id = $2
           ORDER BY position, id`,
          [tenantId, source.id, newDraftId],
        );
        versions = await manager.query(
          `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
                  version.id AS version_id, version.version_no, version.status AS version_status,
                  version.requires_approval, version.revision, version.request_schema,
                  version.prevent_self_approval, version.processing_config, version.updated_at
           FROM workflow_templates template
           JOIN workflow_versions version
             ON version.tenant_id = template.tenant_id AND version.template_id = template.id
           WHERE template.tenant_id = $1 AND template.id = $2 AND version.status = 'draft'`,
          [tenantId, templateId],
        );
      }
      const draft = versions[0];
      if (draft === undefined) {
        throw new PersistenceConflictError(
          'DRAFT_CREATION_FAILED',
          'Workflow draft could not be created',
        );
      }
      const targets = await loadTargets(manager.query.bind(manager), tenantId, draft.version_id);
      return {
        ...mapWorkflow(draft),
        requestSchema: draft.request_schema,
        preventSelfApproval: draft.prevent_self_approval,
        processingConfig: draft.processing_config,
        targets,
      };
    });
  }

  public async saveDraft(
    scope: TenantScope,
    templateId: string,
    actorPrincipalId: string,
    correlationId: string,
    input: DraftAutosaveInput,
  ): Promise<WorkflowDraftRecord> {
    const tenantId = requireTenantId(scope);
    assertValidRequestSchema(input.requestSchema);
    const processingConfig = WorkflowProcessingConfigSchema.safeParse(input.processingConfig);
    const targetValidation = WorkflowTargetsSchema.safeParse(input.targets);
    if (!processingConfig.success || !targetValidation.success) {
      throw new PersistenceConflictError(
        'VALIDATION_FAILED',
        'Workflow execution settings do not match the supported configuration',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ id: string }>(
        await manager.query(
          `UPDATE workflow_versions version
         SET request_schema = $4::jsonb, requires_approval = $5,
             prevent_self_approval = $6, processing_config = $7::jsonb,
             name = $8, description = $9,
             revision = revision + 1, updated_at = clock_timestamp()
         WHERE version.tenant_id = $1 AND version.template_id = $2
           AND version.status = 'draft' AND version.revision = $3
         RETURNING version.id`,
          [
            tenantId,
            templateId,
            input.expectedRevision,
            JSON.stringify(input.requestSchema),
            input.requiresApproval,
            input.preventSelfApproval,
            JSON.stringify(processingConfig.data),
            input.name,
            input.description,
          ],
        ),
      );
      if (rows.length === 0) {
        throw new PersistenceConflictError('STALE_REVISION', 'Workflow draft has changed');
      }
      const draftId = rows[0]?.id;
      if (draftId === undefined || draftId.length === 0) {
        throw new PersistenceConflictError('STALE_REVISION', 'Workflow draft has changed');
      }
      await manager.query(
        `DELETE FROM workflow_targets
         WHERE tenant_id = $1 AND workflow_version_id = $2`,
        [tenantId, draftId],
      );
      for (const target of [...targetValidation.data].sort(
        (left, right) => left.position - right.position,
      )) {
        await manager.query(
          `INSERT INTO workflow_targets
             (tenant_id, id, workflow_version_id, target_kind, position, config)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            tenantId,
            randomUUID(),
            draftId,
            target.targetKind,
            target.position,
            JSON.stringify(target.config),
          ],
        );
      }
      await manager.query(
        `UPDATE workflow_templates
         SET is_enabled = $3, updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, templateId, input.isEnabled],
      );
      await appendAuditEvent(manager, scope, {
        eventType: 'workflow.draft_saved',
        actorPrincipalId,
        actorPrincipalKind: 'user',
        resourceType: 'workflow_template',
        resourceId: templateId,
        correlationId,
        metadata: {
          expectedRevision: input.expectedRevision,
          targetCount: input.targets.length,
          isEnabled: input.isEnabled,
        },
      });
      const result = queryRows<WorkflowDraftRow>(
        await manager.query(
          `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
                version.id AS version_id, version.version_no, version.status AS version_status,
                version.requires_approval, version.revision, version.request_schema,
                version.prevent_self_approval, version.processing_config, version.updated_at
         FROM workflow_templates template
         JOIN workflow_versions version
           ON version.tenant_id = template.tenant_id AND version.template_id = template.id
         WHERE template.tenant_id = $1 AND template.id = $2 AND version.status = 'draft'`,
          [tenantId, templateId],
        ),
      );
      const draft = result[0];
      if (draft === undefined) {
        throw new PersistenceNotFoundError('workflow draft');
      }
      const targets = await loadTargets(manager.query.bind(manager), tenantId, draft.version_id);
      return {
        ...mapWorkflow(draft),
        requestSchema: draft.request_schema,
        preventSelfApproval: draft.prevent_self_approval,
        processingConfig: draft.processing_config,
        targets,
      };
    });
  }

  public async activateDraft(
    scope: TenantScope,
    templateId: string,
    actorPrincipalId: string,
    correlationId: string,
  ): Promise<WorkflowDraftRecord> {
    const tenantId = requireTenantId(scope);
    return withSerializableRetry(this.dataSource, async (manager) => {
      const templates = (await manager.query(
        `SELECT id FROM workflow_templates WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, templateId],
      )) as unknown as Array<{ id: string }>;
      if (templates.length === 0) {
        throw new PersistenceNotFoundError('workflow');
      }
      const drafts = (await manager.query(
        `SELECT id, name, description, request_schema, requires_approval,
                prevent_self_approval, processing_config
         FROM workflow_versions
         WHERE tenant_id = $1 AND template_id = $2 AND status = 'draft'
         FOR UPDATE`,
        [tenantId, templateId],
      )) as unknown as Array<{
        id: string;
        name: string;
        description: string | null;
        request_schema: JsonObject;
        requires_approval: boolean;
        prevent_self_approval: boolean;
        processing_config: JsonObject;
      }>;
      const draft = drafts[0];
      if (draft === undefined) {
        throw new PersistenceNotFoundError('workflow draft');
      }
      assertValidRequestSchema(draft.request_schema);
      const processingConfig = WorkflowProcessingConfigSchema.safeParse(draft.processing_config);
      if (!processingConfig.success) {
        throw new PersistenceConflictError(
          'WORKFLOW_TARGET_INVALID',
          'Workflow processing settings do not match the supported configuration',
        );
      }
      const targets = await loadTargets(manager.query.bind(manager), tenantId, draft.id);
      const validatedTargets = WorkflowTargetsSchema.safeParse(targets);
      if (!validatedTargets.success) {
        throw new PersistenceConflictError(
          'WORKFLOW_TARGET_INVALID',
          'Workflow targets do not match the supported configuration',
        );
      }
      const webhookEndpointIds = [
        ...new Set(
          validatedTargets.data
            .filter((target) => target.targetKind === 'webhook')
            .map((target) => String(target.config.endpointId)),
        ),
      ];
      if (webhookEndpointIds.length > 0) {
        const readyEndpoints = queryRows<{ id: string }>(
          await manager.query(
            `SELECT endpoint.id
             FROM webhook_endpoints endpoint
             JOIN webhook_secrets secret
               ON secret.tenant_id = endpoint.tenant_id
              AND secret.endpoint_id = endpoint.id
              AND secret.status = 'active'
              AND (secret.expires_at IS NULL OR secret.expires_at > clock_timestamp())
             WHERE endpoint.tenant_id = $1
               AND endpoint.id = ANY($2::uuid[])
               AND endpoint.is_enabled
             FOR SHARE OF endpoint, secret`,
            [tenantId, webhookEndpointIds],
          ),
        );
        const readyEndpointIds = new Set(readyEndpoints.map((endpoint) => endpoint.id));
        if (webhookEndpointIds.some((endpointId) => !readyEndpointIds.has(endpointId))) {
          throw new PersistenceConflictError(
            'WORKFLOW_TARGET_UNAVAILABLE',
            'Every webhook target requires an enabled endpoint with an active signing key',
          );
        }
      }
      const userRecipientIds = [
        ...new Set(
          validatedTargets.data
            .filter(
              (target) =>
                target.targetKind === 'notification' && target.config.recipientKind === 'user',
            )
            .map((target) => String(target.config.recipientRef)),
        ),
      ];
      if (userRecipientIds.length > 0) {
        const availableRecipients = queryRows<{ user_id: string }>(
          await manager.query(
            `SELECT membership.user_id
             FROM memberships membership
             JOIN users user_account ON user_account.id = membership.user_id
             WHERE membership.tenant_id = $1
               AND membership.user_id = ANY($2::uuid[])
               AND membership.is_active
               AND user_account.is_active
             FOR SHARE OF membership, user_account`,
            [tenantId, userRecipientIds],
          ),
        );
        const availableRecipientIds = new Set(
          availableRecipients.map((recipient) => recipient.user_id),
        );
        if (userRecipientIds.some((recipientId) => !availableRecipientIds.has(recipientId))) {
          throw new PersistenceConflictError(
            'WORKFLOW_TARGET_UNAVAILABLE',
            'Every user notification target requires an active tenant member',
          );
        }
      }
      const contentHash = hashJson({
        name: draft.name,
        description: draft.description,
        requestSchema: draft.request_schema,
        requiresApproval: draft.requires_approval,
        preventSelfApproval: draft.prevent_self_approval,
        processingConfig: processingConfig.data,
        targets: targets.map((target) => ({
          targetKind: target.targetKind,
          position: target.position,
          config: target.config,
        })),
      });
      await manager.query(
        `UPDATE workflow_versions
         SET status = 'retired', retired_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND template_id = $2 AND status = 'active'`,
        [tenantId, templateId],
      );
      await manager.query(
        `UPDATE workflow_versions
         SET status = 'active', content_hash = $3, activated_at = clock_timestamp(),
             processing_config = $4::jsonb, updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
        [tenantId, draft.id, contentHash, JSON.stringify(processingConfig.data)],
      );
      await manager.query(
        `UPDATE workflow_templates
         SET name = $3, description = $4, updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, templateId, draft.name, draft.description],
      );
      await appendAuditEvent(manager, scope, {
        eventType: 'workflow.activated',
        actorPrincipalId,
        actorPrincipalKind: 'user',
        resourceType: 'workflow_template',
        resourceId: templateId,
        correlationId,
        metadata: { workflowVersionId: draft.id, contentHash },
      });
      const rows = (await manager.query(
        `SELECT template.id, template.stable_key, template.is_enabled, version.name, version.description,
                version.id AS version_id, version.version_no, version.status AS version_status,
                version.requires_approval, version.revision, version.request_schema,
                version.prevent_self_approval, version.processing_config, version.updated_at
         FROM workflow_templates template
         JOIN workflow_versions version
           ON version.tenant_id = template.tenant_id AND version.template_id = template.id
         WHERE template.tenant_id = $1 AND template.id = $2 AND version.status = 'active'`,
        [tenantId, templateId],
      )) as unknown as WorkflowDraftRow[];
      const active = rows[0];
      if (active === undefined) {
        throw new PersistenceConflictError(
          'ACTIVATION_FAILED',
          'Workflow activation did not persist',
        );
      }
      return {
        ...mapWorkflow(active),
        requestSchema: active.request_schema,
        preventSelfApproval: active.prevent_self_approval,
        processingConfig: active.processing_config,
        targets: await loadTargets(manager.query.bind(manager), tenantId, active.version_id),
      };
    });
  }
}

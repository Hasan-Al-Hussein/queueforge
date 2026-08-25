import { randomUUID } from 'node:crypto';

import { hash, argon2id } from 'argon2';
import type { DataSource, EntityManager } from 'typeorm';

import type { SeedEnvironment } from '@queueforge/config';
import { hashJson } from '@queueforge/domain';

import { encryptWebhookSecret } from './stores/webhook-secret.store.js';

const DEMO_IDS = Object.freeze({
  acmeTenant: '10000000-0000-4000-8000-000000000001',
  betaTenant: '10000000-0000-4000-8000-000000000002',
  adminUser: '20000000-0000-4000-8000-000000000001',
  approverUser: '20000000-0000-4000-8000-000000000002',
  operatorUser: '20000000-0000-4000-8000-000000000003',
  outsiderUser: '20000000-0000-4000-8000-000000000004',
  expenseTemplate: '30000000-0000-4000-8000-000000000001',
  expenseVersion: '40000000-0000-4000-8000-000000000001',
  accessTemplate: '30000000-0000-4000-8000-000000000002',
  accessVersion: '40000000-0000-4000-8000-000000000002',
  webhookEndpoint: '50000000-0000-4000-8000-000000000001',
});

async function seedUser(
  manager: EntityManager,
  id: string,
  email: string,
  displayName: string,
  passwordHash: string,
  platformAdmin = false,
): Promise<void> {
  await manager.query(
    `INSERT INTO users (id, email, display_name, password_hash, platform_role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET display_name = EXCLUDED.display_name, password_hash = EXCLUDED.password_hash,
           platform_role = EXCLUDED.platform_role, is_active = true, updated_at = clock_timestamp()`,
    [id, email, displayName, passwordHash, platformAdmin ? 'platform_admin' : null],
  );
}

async function seedWorkflow(
  manager: EntityManager,
  input: {
    tenantId: string;
    templateId: string;
    versionId: string;
    stableKey: string;
    name: string;
    description: string;
    requestSchema: Record<string, unknown>;
    requiresApproval: boolean;
    preventSelfApproval: boolean;
    createdBy: string;
  },
): Promise<void> {
  await manager.query(
    `INSERT INTO workflow_templates
       (tenant_id, id, stable_key, name, description, is_enabled, created_by_principal_id)
     VALUES ($1, $2, $3, $4, $5, true, $6)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [
      input.tenantId,
      input.templateId,
      input.stableKey,
      input.name,
      input.description,
      input.createdBy,
    ],
  );
  await manager.query(
    `INSERT INTO workflow_versions
       (tenant_id, id, template_id, version_no, status, name, description, revision,
        request_schema, requires_approval, prevent_self_approval, processing_config,
        created_by_principal_id)
     VALUES ($1, $2, $3, 1, 'draft', $4, $5, 1, $6::jsonb, $7, $8,
             '{"durationMs":250,"failuresBeforeSuccess":0,"maxAttempts":5}'::jsonb, $9)
     ON CONFLICT (tenant_id, id) DO NOTHING`,
    [
      input.tenantId,
      input.versionId,
      input.templateId,
      input.name,
      input.description,
      JSON.stringify(input.requestSchema),
      input.requiresApproval,
      input.preventSelfApproval,
      input.createdBy,
    ],
  );
}

export async function seedQueueForge(
  dataSource: DataSource,
  environment: SeedEnvironment,
): Promise<void> {
  const passwordHash = await hash(environment.BOOTSTRAP_ADMIN_PASSWORD, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  await dataSource.transaction(async (manager) => {
    await manager.query(
      `INSERT INTO tenants (id, slug, name) VALUES
         ($1, $2, 'Acme Operations'), ($3, 'beta-demo', 'Beta Logistics')
       ON CONFLICT (id) DO UPDATE SET is_active = true, updated_at = clock_timestamp()`,
      [DEMO_IDS.acmeTenant, environment.BOOTSTRAP_TENANT_SLUG, DEMO_IDS.betaTenant],
    );
    await seedUser(
      manager,
      DEMO_IDS.adminUser,
      environment.BOOTSTRAP_ADMIN_EMAIL,
      'QueueForge Admin',
      passwordHash,
      true,
    );
    await seedUser(
      manager,
      DEMO_IDS.approverUser,
      'approver@queueforge.local',
      'Amina Approver',
      passwordHash,
    );
    await seedUser(
      manager,
      DEMO_IDS.operatorUser,
      'operator@queueforge.local',
      'Omar Operator',
      passwordHash,
    );
    await seedUser(
      manager,
      DEMO_IDS.outsiderUser,
      'outsider@queueforge.local',
      'Bianca Beta',
      passwordHash,
    );
    await manager.query(
      `INSERT INTO memberships (tenant_id, user_id, role, role_locked) VALUES
         ($1, $2, 'tenant_admin', true), ($1, $3, 'approver', true),
         ($1, $4, 'operator', true), ($5, $2, 'tenant_admin', true),
         ($5, $6, 'operator', true)
       ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role = EXCLUDED.role, role_locked = EXCLUDED.role_locked,
             is_active = true, updated_at = clock_timestamp()`,
      [
        DEMO_IDS.acmeTenant,
        DEMO_IDS.adminUser,
        DEMO_IDS.approverUser,
        DEMO_IDS.operatorUser,
        DEMO_IDS.betaTenant,
        DEMO_IDS.outsiderUser,
      ],
    );

    await manager.query(
      `INSERT INTO webhook_endpoints
         (tenant_id, id, name, url, is_enabled, created_by_principal_id)
       VALUES ($1, $2, 'Local audit sink', $4, true, $3)
       ON CONFLICT (tenant_id, id) DO UPDATE
         SET name = EXCLUDED.name, url = EXCLUDED.url, is_enabled = true,
             updated_at = clock_timestamp()`,
      [
        DEMO_IDS.acmeTenant,
        DEMO_IDS.webhookEndpoint,
        DEMO_IDS.adminUser,
        environment.DEMO_WEBHOOK_TARGET_URL,
      ],
    );
    const signingSecret = environment.SINK_SECRET;
    const keyId = 'local-v1';
    const secretId = '50000000-0000-4000-8000-000000000002';
    const encrypted = encryptWebhookSecret(
      environment.WEBHOOK_MASTER_KEY,
      {
        tenantId: DEMO_IDS.acmeTenant,
        endpointId: DEMO_IDS.webhookEndpoint,
        keyId,
        masterKeyVersion: 1,
      },
      signingSecret,
    );
    await manager.query(
      `INSERT INTO webhook_secrets
         (tenant_id, id, endpoint_id, key_id, ciphertext, iv, auth_tag,
          master_key_version, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 'active')
       ON CONFLICT (tenant_id, id) DO NOTHING`,
      [
        DEMO_IDS.acmeTenant,
        secretId,
        DEMO_IDS.webhookEndpoint,
        keyId,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
      ],
    );

    await seedWorkflow(manager, {
      tenantId: DEMO_IDS.acmeTenant,
      templateId: DEMO_IDS.expenseTemplate,
      versionId: DEMO_IDS.expenseVersion,
      stableKey: 'expense_review',
      name: 'Expense review',
      description: 'Approval-gated expense review with signed completion delivery.',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['amount', 'costCenter', 'summary'],
        properties: {
          amount: { type: 'number', minimum: 1, maximum: 100_000 },
          costCenter: { type: 'string', minLength: 2, maxLength: 40 },
          summary: { type: 'string', minLength: 3, maxLength: 500 },
        },
      },
      requiresApproval: true,
      preventSelfApproval: true,
      createdBy: DEMO_IDS.adminUser,
    });
    await manager.query(
      `INSERT INTO workflow_targets
         (tenant_id, id, workflow_version_id, target_kind, position, config)
       SELECT $1, target.id, $3, target.kind, target.position, target.config
       FROM (VALUES
         ($2::uuid, 'processor'::text, 0, '{"handler":"demo"}'::jsonb),
         ($4::uuid, 'webhook'::text, 1, jsonb_build_object('endpointId', $5::text)),
         ($6::uuid, 'notification'::text, 2,
           '{"recipientKind":"role","recipientRef":"operator","title":"Expense completed"}'::jsonb)
       ) AS target(id, kind, position, config)
       WHERE EXISTS (
         SELECT 1 FROM workflow_versions
         WHERE tenant_id = $1 AND id = $3 AND status = 'draft'
       )
       ON CONFLICT (tenant_id, workflow_version_id, position) DO NOTHING`,
      [
        DEMO_IDS.acmeTenant,
        randomUUID(),
        DEMO_IDS.expenseVersion,
        randomUUID(),
        DEMO_IDS.webhookEndpoint,
        randomUUID(),
      ],
    );

    await seedWorkflow(manager, {
      tenantId: DEMO_IDS.betaTenant,
      templateId: DEMO_IDS.accessTemplate,
      versionId: DEMO_IDS.accessVersion,
      stableKey: 'access_review',
      name: 'Access review',
      description: 'Isolated second-tenant workflow for authorization demonstrations.',
      requestSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['system', 'reason'],
        properties: {
          system: { type: 'string', minLength: 2, maxLength: 80 },
          reason: { type: 'string', minLength: 3, maxLength: 500 },
        },
      },
      requiresApproval: false,
      preventSelfApproval: false,
      createdBy: DEMO_IDS.adminUser,
    });
    await manager.query(
      `INSERT INTO workflow_targets
         (tenant_id, id, workflow_version_id, target_kind, position, config)
       SELECT $1, $2, $3, 'processor', 0, '{"handler":"demo"}'::jsonb
       WHERE EXISTS (
         SELECT 1 FROM workflow_versions
         WHERE tenant_id = $1 AND id = $3 AND status = 'draft'
       )
       ON CONFLICT (tenant_id, workflow_version_id, position) DO NOTHING`,
      [DEMO_IDS.betaTenant, randomUUID(), DEMO_IDS.accessVersion],
    );

    for (const workflow of [
      {
        tenantId: DEMO_IDS.acmeTenant,
        versionId: DEMO_IDS.expenseVersion,
        name: 'Expense review',
        description: 'Approval-gated expense review with signed completion delivery.',
      },
      {
        tenantId: DEMO_IDS.betaTenant,
        versionId: DEMO_IDS.accessVersion,
        name: 'Access review',
        description: 'Isolated second-tenant workflow for authorization demonstrations.',
      },
    ]) {
      const rows = (await manager.query(
        `SELECT request_schema, requires_approval, prevent_self_approval, processing_config
         FROM workflow_versions WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
        [workflow.tenantId, workflow.versionId],
      )) as unknown as Array<{
        request_schema: Record<string, unknown>;
        requires_approval: boolean;
        prevent_self_approval: boolean;
        processing_config: Record<string, unknown>;
      }>;
      const version = rows[0];
      if (version !== undefined) {
        const targets = (await manager.query(
          `SELECT target_kind, position, config
           FROM workflow_targets
           WHERE tenant_id = $1 AND workflow_version_id = $2
           ORDER BY position, id`,
          [workflow.tenantId, workflow.versionId],
        )) as unknown as Array<{
          target_kind: 'processor' | 'webhook' | 'notification';
          position: number;
          config: Record<string, unknown>;
        }>;
        const contentHash = hashJson({
          name: workflow.name,
          description: workflow.description,
          requestSchema: version.request_schema,
          requiresApproval: version.requires_approval,
          preventSelfApproval: version.prevent_self_approval,
          processingConfig: version.processing_config,
          targets: targets.map((target) => ({
            targetKind: target.target_kind,
            position: target.position,
            config: target.config,
          })),
        });
        await manager.query(
          `UPDATE workflow_versions
           SET status = 'active', content_hash = $3, activated_at = clock_timestamp(),
               updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
          [workflow.tenantId, workflow.versionId, contentHash],
        );
      }
    }
  });
}

export { DEMO_IDS };

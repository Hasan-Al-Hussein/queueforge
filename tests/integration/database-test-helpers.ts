import { randomUUID } from 'node:crypto';

import { createQueueForgeDataSource } from '../../packages/persistence/src/index.js';

export { cleanupTenant, cleanupUser } from '../database-cleanup.js';

export type TestDataSource = ReturnType<typeof createQueueForgeDataSource>;

export interface SqlExecutor {
  query(sql: string, parameters?: unknown[]): Promise<unknown>;
}

export interface WorkflowFixture {
  readonly actorId: string;
  readonly processorTargetId: string;
  readonly stableKey: string;
  readonly templateId: string;
  readonly tenantId: string;
  readonly versionId: string;
}

function requiredEnvironment(name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL'): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for database integration tests`);
  }
  return value;
}

export function createRuntimeDataSource(applicationName: string): TestDataSource {
  return createQueueForgeDataSource({
    applicationName,
    databaseUrl: requiredEnvironment('DATABASE_URL'),
    includeMigrations: false,
  });
}

export function createOwnerDataSource(applicationName: string): TestDataSource {
  return createQueueForgeDataSource({
    applicationName,
    databaseUrl: requiredEnvironment('MIGRATION_DATABASE_URL'),
    includeMigrations: true,
  });
}

export async function withRollback<T>(
  dataSource: TestDataSource,
  operation: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    return await operation(runner);
  } finally {
    if (runner.isTransactionActive) {
      await runner.rollbackTransaction();
    }
    await runner.release();
  }
}

export async function insertTenant(
  executor: SqlExecutor,
  tenantId = randomUUID(),
): Promise<string> {
  await executor.query(
    `INSERT INTO tenants (id, slug, name)
     VALUES ($1, $2, 'QueueForge integration tenant')`,
    [tenantId, `qa-${tenantId}`],
  );
  return tenantId;
}

export async function insertWorkflow(
  executor: SqlExecutor,
  options: {
    readonly requiresApproval?: boolean;
    readonly status?: 'active' | 'draft';
    readonly tenantId?: string;
  } = {},
): Promise<WorkflowFixture> {
  const tenantId = options.tenantId ?? (await insertTenant(executor));
  const templateId = randomUUID();
  const versionId = randomUUID();
  const processorTargetId = randomUUID();
  const actorId = randomUUID();
  const stableKey = `qa_${templateId.replaceAll('-', '')}`;
  const status = options.status ?? 'active';
  await executor.query(
    `INSERT INTO workflow_templates
       (tenant_id, id, stable_key, name, description, is_enabled, created_by_principal_id)
     VALUES ($1, $2, $3, 'QA workflow', 'Synthetic integration fixture', true, $4)`,
    [tenantId, templateId, stableKey, actorId],
  );
  await executor.query(
    `INSERT INTO workflow_versions
       (tenant_id, id, template_id, version_no, status, name, description, revision,
        request_schema, requires_approval, prevent_self_approval, processing_config,
        content_hash, created_by_principal_id, activated_at)
     VALUES ($1, $2, $3, 1, 'draft', 'QA workflow', 'Synthetic integration fixture', 1,
             $4::jsonb, $5, false, '{}'::jsonb, NULL, $6, NULL)`,
    [
      tenantId,
      versionId,
      templateId,
      JSON.stringify({ additionalProperties: true, type: 'object' }),
      options.requiresApproval ?? false,
      actorId,
    ],
  );
  await executor.query(
    `INSERT INTO workflow_targets
       (tenant_id, id, workflow_version_id, target_kind, position, config)
     VALUES ($1, $2, $3, 'processor', 0, '{"handler":"demo"}'::jsonb)`,
    [tenantId, processorTargetId, versionId],
  );
  if (status === 'active') {
    await executor.query(
      `UPDATE workflow_versions
       SET status = 'active', content_hash = $3, activated_at = clock_timestamp()
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, versionId, 'a'.repeat(64)],
    );
  }
  return { actorId, processorTargetId, stableKey, templateId, tenantId, versionId };
}

export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

export async function rejectedPostgresCode(
  operation: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await operation;
    return undefined;
  } catch (error) {
    return postgresErrorCode(error);
  }
}

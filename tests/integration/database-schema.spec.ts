import { randomUUID } from 'node:crypto';

import {
  createOwnerDataSource,
  createRuntimeDataSource,
  insertTenant,
  insertWorkflow,
  rejectedPostgresCode,
  type TestDataSource,
  withRollback,
} from './database-test-helpers.js';

const APPEND_ONLY_TABLES = [
  'approval_decisions',
  'audit_events',
  'inbound_webhook_receipts',
  'outbox_attempts',
  'processed_events',
  'request_attempts',
  'request_transitions',
  'security_events',
  'webhook_delivery_attempts',
] as const;

describe('PostgreSQL migration and isolation invariants', () => {
  let runtime: TestDataSource;
  let owner: TestDataSource;

  beforeAll(async () => {
    runtime = createRuntimeDataSource('queueforge-qa-schema-runtime');
    owner = createOwnerDataSource('queueforge-qa-schema-owner');
    await Promise.all([runtime.initialize(), owner.initialize()]);
  });

  afterAll(async () => {
    await Promise.all([
      runtime.isInitialized ? runtime.destroy() : Promise.resolve(),
      owner.isInitialized ? owner.destroy() : Promise.resolve(),
    ]);
  });

  it('has the authoritative migration applied with synchronization disabled', async () => {
    const applied = (await owner.query(
      `SELECT name FROM migrations ORDER BY timestamp`,
    )) as unknown as Array<{ name: string }>;
    const extensions = (await owner.query(
      `SELECT extname FROM pg_extension WHERE extname = 'pgcrypto'`,
    )) as unknown as Array<{ extname: string }>;
    const securityCorrelation = (await owner.query(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'security_events'
         AND column_name = 'correlation_id'`,
    )) as unknown as Array<{ column_name: string; is_nullable: string }>;
    const securityCorrelationIndex = (await owner.query(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'security_events_correlation_idx'`,
    )) as unknown as Array<{ indexname: string }>;
    const membershipRoleLock = (await owner.query(
      `SELECT column_name, column_default, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'memberships'
         AND column_name = 'role_locked'`,
    )) as unknown as Array<{
      column_default: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>;
    const requestAttemptSequence = (await owner.query(
      `SELECT column_name, column_default, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workflow_requests'
         AND column_name = 'attempt_sequence'`,
    )) as unknown as Array<{
      column_default: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>;
    const outboxAttemptSequence = (await owner.query(
      `SELECT column_name, column_default, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'outbox_events'
         AND column_name = 'attempt_sequence'`,
    )) as unknown as Array<{
      column_default: string;
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>;

    expect(owner.options.synchronize).toBe(false);
    await expect(owner.showMigrations()).resolves.toBe(false);
    expect(applied.map((row) => row.name)).toContain('InitialSchema1700000000000');
    expect(applied.map((row) => row.name)).toContain('SecurityEventCorrelation1700000003000');
    expect(applied.map((row) => row.name)).toContain('MembershipRoleLock1700000005000');
    expect(applied.map((row) => row.name)).toContain('RequestAttemptSequence1700000006000');
    expect(applied.map((row) => row.name)).toContain('OutboxAttemptSequence1700000007000');
    expect(extensions).toEqual([{ extname: 'pgcrypto' }]);
    expect(securityCorrelation).toEqual([{ column_name: 'correlation_id', is_nullable: 'NO' }]);
    expect(securityCorrelationIndex).toEqual([{ indexname: 'security_events_correlation_idx' }]);
    expect(membershipRoleLock).toEqual([
      {
        column_default: 'false',
        column_name: 'role_locked',
        data_type: 'boolean',
        is_nullable: 'NO',
      },
    ]);
    expect(requestAttemptSequence).toEqual([
      {
        column_default: '0',
        column_name: 'attempt_sequence',
        data_type: 'integer',
        is_nullable: 'NO',
      },
    ]);
    expect(outboxAttemptSequence).toEqual([
      {
        column_default: '0',
        column_name: 'attempt_sequence',
        data_type: 'integer',
        is_nullable: 'NO',
      },
    ]);
  });

  it('rejects a cross-tenant workflow request at the composite foreign key', async () => {
    await withRollback(runtime, async (executor) => {
      const workflow = await insertWorkflow(executor);
      const otherTenantId = await insertTenant(executor);

      const insertion = executor.query(
        `INSERT INTO workflow_requests
           (tenant_id, id, workflow_template_id, workflow_version_id, status, source,
            payload, payload_hash, correlation_id, submitted_by_principal_id,
            submitted_by_principal_kind, submitted_at, status_changed_at)
         VALUES ($1, $2, $3, $4, 'queued', 'system', '{}'::jsonb, $5, $6, $7,
                 'system', clock_timestamp(), clock_timestamp())`,
        [
          otherTenantId,
          randomUUID(),
          workflow.templateId,
          workflow.versionId,
          'b'.repeat(64),
          randomUUID(),
          randomUUID(),
        ],
      );

      await expect(rejectedPostgresCode(insertion)).resolves.toBe('23503');
    });
  });

  it('prevents content and target mutations after workflow activation', async () => {
    await withRollback(runtime, async (executor) => {
      const workflow = await insertWorkflow(executor, { status: 'draft' });
      await executor.query(
        `UPDATE workflow_versions
         SET status = 'active', content_hash = $3, activated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2`,
        [workflow.tenantId, workflow.versionId, 'c'.repeat(64)],
      );

      await executor.query('SAVEPOINT immutable_version');
      await expect(
        rejectedPostgresCode(
          executor.query(
            `UPDATE workflow_versions SET name = 'tampered' WHERE tenant_id = $1 AND id = $2`,
            [workflow.tenantId, workflow.versionId],
          ),
        ),
      ).resolves.toBe('55000');
      await executor.query('ROLLBACK TO SAVEPOINT immutable_version');

      await executor.query('SAVEPOINT immutable_target');
      await expect(
        rejectedPostgresCode(
          executor.query(`DELETE FROM workflow_targets WHERE tenant_id = $1 AND id = $2`, [
            workflow.tenantId,
            workflow.processorTargetId,
          ]),
        ),
      ).resolves.toBe('55000');
      await executor.query('ROLLBACK TO SAVEPOINT immutable_target');

      await executor.query('SAVEPOINT new_active_target');
      await expect(
        rejectedPostgresCode(
          executor.query(
            `INSERT INTO workflow_targets
             (tenant_id, id, workflow_version_id, target_kind, position, config)
           VALUES ($1, $2, $3, 'processor', 1, '{}'::jsonb)`,
            [workflow.tenantId, randomUUID(), workflow.versionId],
          ),
        ),
      ).resolves.toBe('55000');
      await executor.query('ROLLBACK TO SAVEPOINT new_active_target');
    });
  });

  it('revokes runtime mutations and retains trigger defense for append-only history', async () => {
    const privileges = (await runtime.query(
      `SELECT table_name,
              has_table_privilege(current_user, format('public.%I', table_name), 'UPDATE') AS can_update,
              has_table_privilege(current_user, format('public.%I', table_name), 'DELETE') AS can_delete,
              has_table_privilege(current_user, format('public.%I', table_name), 'TRUNCATE') AS can_truncate
       FROM unnest($1::text[]) AS tables(table_name)
       ORDER BY table_name`,
      [[...APPEND_ONLY_TABLES]],
    )) as unknown as Array<{
      table_name: string;
      can_update: boolean;
      can_delete: boolean;
      can_truncate: boolean;
    }>;

    expect(privileges).toHaveLength(APPEND_ONLY_TABLES.length);
    expect(privileges.every((row) => !row.can_update && !row.can_delete && !row.can_truncate)).toBe(
      true,
    );

    await withRollback(owner, async (executor) => {
      const tenantId = await insertTenant(executor);
      const auditId = randomUUID();
      await executor.query(
        `INSERT INTO audit_events
           (tenant_id, id, event_type, actor_principal_kind, resource_type,
            resource_id, correlation_id, safe_metadata)
         VALUES ($1, $2, 'qa.append_only', 'system', 'qa_fixture', $3, $4, '{}'::jsonb)`,
        [tenantId, auditId, randomUUID(), randomUUID()],
      );
      await expect(
        rejectedPostgresCode(
          executor.query(
            `UPDATE audit_events SET event_type = 'qa.tampered' WHERE tenant_id = $1 AND id = $2`,
            [tenantId, auditId],
          ),
        ),
      ).resolves.toBe('55000');
    });
  });
});

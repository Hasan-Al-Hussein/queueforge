import type { DataSource, EntityManager, QueryRunner } from 'typeorm';

import { hashJson } from '@queueforge/domain';

import { InitialSchema1700000000000 } from './migrations/1700000000000-initial-schema.js';
import { queryRows } from './query-result.js';
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
  WebhookSecretStore,
} from './stores/webhook-secret.store.js';
import { RequestExecutionStore } from './stores/request-execution.store.js';
import { ReadModelStore } from './stores/read-model.store.js';
import { WorkflowStore } from './stores/workflow.store.js';
import { withReadCommittedRetry, withSerializableRetry } from './transaction-retry.js';

describe('raw PostgreSQL query results', () => {
  it('normalizes TypeORM UPDATE/DELETE tuples and preserves flat SELECT/INSERT rows', () => {
    const returned = [{ id: 'returned-id' }];
    expect(queryRows<{ id: string }>([returned, 1])).toEqual(returned);
    expect(queryRows<{ id: string }>(returned)).toEqual(returned);
    expect(queryRows<{ id: string }>([[], 0])).toEqual([]);
  });

  it('rejects an unexpected driver result shape', () => {
    expect(() => queryRows<{ id: string }>({ rows: [] })).toThrow(TypeError);
  });
});

describe('request execution configuration', () => {
  it('loads immutable workflow processing config while locking the request attempt', async () => {
    const processingConfig = { simulation: { durationMs: 10, failuresBeforeSuccess: 2 } };
    const processorConfig = { handler: 'demo' };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM workflow_requests request')) {
        return [
          {
            id: '80000000-0000-4000-8000-000000000001',
            status: 'queued',
            attempt_count: 0,
            max_attempts: 5,
            correlation_id: '90000000-0000-4000-8000-000000000001',
            status_changed_at: new Date('2026-08-24T00:00:00.000Z'),
            workflow_version_id: '40000000-0000-4000-8000-000000000001',
            processing_config: processingConfig,
            processor_config: processorConfig,
          },
        ];
      }
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (operation: (value: EntityManager) => unknown) =>
        operation(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new RequestExecutionStore(dataSource).beginAttempt(
        { tenantId: '10000000-0000-4000-8000-000000000001' },
        '80000000-0000-4000-8000-000000000001',
        'worker-test',
      ),
    ).resolves.toMatchObject({ attemptNo: 1, processingConfig, processorConfig });
    expect(query.mock.calls[0]?.[0]).toContain('version.processing_config');
    expect(query.mock.calls[0]?.[0]).toContain("target.target_kind = 'processor'");
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE OF request');
  });

  it('receipts a cancelled queued event without starting an immortal retry', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT 1 FROM processed_events')) {
        return [];
      }
      if (sql.includes('FROM workflow_requests request')) {
        return [
          {
            id: '80000000-0000-4000-8000-000000000001',
            status: 'cancelled',
            attempt_count: 0,
            max_attempts: 5,
            correlation_id: '90000000-0000-4000-8000-000000000001',
            status_changed_at: new Date('2026-08-24T00:00:00.000Z'),
            workflow_version_id: '40000000-0000-4000-8000-000000000001',
            processing_config: {},
            processor_config: { handler: 'demo' },
          },
        ];
      }
      if (sql.includes('INSERT INTO processed_events')) {
        return [{ event_id: '70000000-0000-4000-8000-000000000001' }];
      }
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(async (operation: (value: EntityManager) => unknown) =>
        operation(manager),
      ),
    } as unknown as DataSource;

    await expect(
      new RequestExecutionStore(dataSource).beginOrRecoverAttempt(
        { tenantId: '10000000-0000-4000-8000-000000000001' },
        '80000000-0000-4000-8000-000000000001',
        'worker-test',
        new Date(),
        {
          consumer: 'queueforge.request-executor.v1',
          eventId: '70000000-0000-4000-8000-000000000001',
        },
      ),
    ).resolves.toEqual({ duplicate: true });
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("SET status = 'processing'")),
    ).toBe(false);
  });
});

describe('read model pagination', () => {
  it('retains request and audit totals when a page is beyond the last row', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('SELECT count(*)::integer AS count') && sql.includes('workflow_requests')) {
        return [{ count: 17 }];
      }
      if (sql.includes('SELECT count(*)::integer AS count') && sql.includes('audit_events')) {
        return [{ count: 23 }];
      }
      return [];
    });
    const store = new ReadModelStore({ query } as unknown as DataSource);
    const context = {
      principalId: '20000000-0000-4000-8000-000000000001',
      principalKind: 'user' as const,
      role: 'tenant_admin' as const,
      tenantId: '10000000-0000-4000-8000-000000000001',
    };

    await expect(store.listRequests(context, 99, 25)).resolves.toEqual({
      items: [],
      page: 99,
      pageSize: 25,
      totalItems: 17,
      totalPages: 1,
    });
    await expect(store.listAudit(context, 99, 25)).resolves.toEqual({
      items: [],
      page: 99,
      pageSize: 25,
      totalItems: 23,
      totalPages: 1,
    });
  });
});

describe('webhook secret cryptography', () => {
  const masterKey = Buffer.alloc(32, 7).toString('base64');
  const binding = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    endpointId: '50000000-0000-4000-8000-000000000001',
    keyId: 'local-v1',
    masterKeyVersion: 1,
  };

  it('round-trips AES-GCM only for the exact tenant/endpoint/key binding', () => {
    const encrypted = encryptWebhookSecret(masterKey, binding, 'super-secret');
    expect(decryptWebhookSecret(masterKey, binding, encrypted)).toBe('super-secret');
    expect(() =>
      decryptWebhookSecret(masterKey, { ...binding, keyId: 'other-key' }, encrypted),
    ).toThrow();
  });

  it('rejects ciphertext tampering', () => {
    const encrypted = encryptWebhookSecret(masterKey, binding, 'super-secret');
    const ciphertext = Buffer.from(encrypted.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    expect(() => decryptWebhookSecret(masterKey, binding, { ...encrypted, ciphertext })).toThrow();
  });

  it('classifies persisted ciphertext corruption as a typed terminal secret fault', async () => {
    const encrypted = encryptWebhookSecret(masterKey, binding, 'super-secret');
    const ciphertext = Buffer.from(encrypted.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const store = new WebhookSecretStore({
      query: jest.fn().mockResolvedValue([
        {
          auth_tag: encrypted.authTag,
          ciphertext,
          iv: encrypted.iv,
          master_key_version: 1,
        },
      ]),
    } as unknown as DataSource);

    await expect(
      store.getSigningSecret(
        { tenantId: binding.tenantId },
        binding.endpointId,
        binding.keyId,
        masterKey,
      ),
    ).rejects.toMatchObject({ code: 'WEBHOOK_SECRET_INVALID' });
  });
});

describe('serializable transaction retry', () => {
  it('retries only transient SQLSTATE failures with a new transaction', async () => {
    const transaction = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('serialization'), { code: '40001' }))
      .mockResolvedValueOnce('replayed');
    const dataSource = { transaction } as unknown as DataSource;
    await expect(withSerializableRetry(dataSource, async () => 'unused')).resolves.toBe('replayed');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated database failures', async () => {
    const failure = Object.assign(new Error('constraint'), { code: '23505' });
    const transaction = jest.fn().mockRejectedValue(failure);
    await expect(
      withSerializableRetry({ transaction } as unknown as DataSource, async () => 'unused'),
    ).rejects.toBe(failure);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('uses READ COMMITTED for row-lock and uniqueness-based public commands', async () => {
    const transaction = jest.fn().mockResolvedValue('committed');
    await expect(
      withReadCommittedRetry({ transaction } as unknown as DataSource, async () => 'unused'),
    ).resolves.toBe('committed');
    expect(transaction).toHaveBeenCalledWith('READ COMMITTED', expect.any(Function));
  });
});

describe('initial migration invariants', () => {
  it('emits tenant binding, immutable workflow targets, append-only grants, and open-only DLQ uniqueness', async () => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn(async (statement: string) => {
        statements.push(statement);
        return [];
      }),
    } as unknown as QueryRunner;
    await new InitialSchema1700000000000().up(runner);
    const sql = statements.join('\n');
    const attempts = sql.slice(
      sql.indexOf('CREATE TABLE request_attempts'),
      sql.indexOf('CREATE TABLE approval_tasks'),
    );
    const approvals = sql.slice(
      sql.indexOf('CREATE TABLE approval_tasks'),
      sql.indexOf('CREATE TABLE approval_decisions'),
    );
    expect(attempts).toContain('FOREIGN KEY (tenant_id, request_id)');
    expect(attempts).not.toContain('workflow_version_id, payload_hash');
    expect(approvals).toContain(
      'FOREIGN KEY (tenant_id, request_id, workflow_version_id, payload_hash)',
    );
    expect(sql).toContain('CREATE TRIGGER workflow_targets_draft_only');
    expect(sql).toContain('BEFORE INSERT OR UPDATE OR DELETE ON workflow_targets');
    expect(sql).toContain('content_hash IS NULL OR length(content_hash) = 64');
    expect(sql).toContain('dead_letters_one_open_uq');
    expect(sql).toContain("WHERE status = 'open'");
    expect(sql).toContain('REVOKE UPDATE, DELETE, TRUNCATE ON');
  });
});

describe('workflow activation', () => {
  it('includes ordered targets in the immutable content hash and returned detail', async () => {
    const tenantId = '10000000-0000-4000-8000-000000000001';
    const templateId = '30000000-0000-4000-8000-000000000001';
    const versionId = '40000000-0000-4000-8000-000000000001';
    const updatedAt = new Date('2026-08-24T00:00:00.000Z');
    const targets = [
      { target_kind: 'processor', position: 0, config: { handler: 'demo' } },
      {
        target_kind: 'webhook',
        position: 1,
        config: { endpointId: '50000000-0000-4000-8000-000000000001' },
      },
    ];
    const query = jest.fn(async (sql: string, parameters?: unknown[]) => {
      void parameters;
      if (sql.includes('SELECT id FROM workflow_templates')) return [{ id: templateId }];
      if (sql.includes('SELECT id, name, description, request_schema')) {
        return [
          {
            id: versionId,
            name: 'Expense review',
            description: 'Immutable',
            request_schema: { type: 'object' },
            requires_approval: false,
            prevent_self_approval: false,
            processing_config: { durationMs: 250, failuresBeforeSuccess: 0, maxAttempts: 5 },
          },
        ];
      }
      if (sql.includes('SELECT target_kind, position, config')) return targets;
      if (sql.includes('SELECT endpoint.id')) {
        return [{ id: '50000000-0000-4000-8000-000000000001' }];
      }
      if (sql.includes("version.status = 'active'")) {
        return [
          {
            id: templateId,
            stable_key: 'expense_review',
            is_enabled: true,
            name: 'Expense review',
            description: 'Immutable',
            version_id: versionId,
            version_no: 1,
            version_status: 'active',
            requires_approval: false,
            revision: 1,
            request_schema: { type: 'object' },
            prevent_self_approval: false,
            processing_config: { durationMs: 250, failuresBeforeSuccess: 0, maxAttempts: 5 },
            updated_at: updatedAt,
          },
        ];
      }
      return [];
    });
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn(
        async (_isolation: string, operation: (value: EntityManager) => unknown) =>
          operation(manager),
      ),
    } as unknown as DataSource;
    const result = await new WorkflowStore(dataSource).activateDraft(
      { tenantId },
      templateId,
      '20000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
    );
    const activation = query.mock.calls.find(([sql]) =>
      String(sql).includes("SET status = 'active', content_hash"),
    );
    expect(activation?.[1]?.[2]).toBe(
      hashJson({
        name: 'Expense review',
        description: 'Immutable',
        requestSchema: { type: 'object' },
        requiresApproval: false,
        preventSelfApproval: false,
        processingConfig: { durationMs: 250, failuresBeforeSuccess: 0, maxAttempts: 5 },
        targets: [
          { targetKind: 'processor', position: 0, config: { handler: 'demo' } },
          {
            targetKind: 'webhook',
            position: 1,
            config: { endpointId: '50000000-0000-4000-8000-000000000001' },
          },
        ],
      }),
    );
    expect(result.targets).toHaveLength(2);
  });
});

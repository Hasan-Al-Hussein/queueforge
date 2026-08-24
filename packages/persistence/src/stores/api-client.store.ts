import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { JsonObject, TenantContext } from '@queueforge/contracts';

import { PersistenceConflictError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';

export type ApiClientRole = 'operator' | 'viewer';

export interface ApiClientRecord {
  readonly createdAt: Date;
  readonly id: string;
  readonly keyId: string;
  readonly lastUsedAt: Date | null;
  readonly name: string;
  readonly revokedAt: Date | null;
  readonly role: ApiClientRole;
  readonly tenantId: string;
}

export interface ApiClientCredentialRecord {
  readonly id: string;
  readonly role: ApiClientRole;
  readonly secretHash: string;
  readonly tenantId: string;
}

export interface CreateApiClientStoreResult {
  readonly record: ApiClientRecord;
  readonly replayed: boolean;
}

interface ApiClientRow {
  created_at: Date;
  id: string;
  key_id: string;
  last_used_at: Date | null;
  name: string;
  revoked_at: Date | null;
  role: ApiClientRole;
  tenant_id: string;
}

interface ApiClientCredentialRow {
  id: string;
  role: ApiClientRole;
  secret_hash: string;
  tenant_id: string;
}

interface ApiClientIdempotencyRow {
  principal_id: string;
  request_fingerprint: string;
  response_body: JsonObject | null;
  status: 'completed' | 'processing';
}

function mapApiClient(row: ApiClientRow): ApiClientRecord {
  return {
    createdAt: row.created_at,
    id: row.id,
    keyId: row.key_id,
    lastUsedAt: row.last_used_at,
    name: row.name,
    revokedAt: row.revoked_at,
    role: row.role,
    tenantId: row.tenant_id,
  };
}

async function readApiClient(
  manager: EntityManager,
  tenantId: string,
  apiClientId: string,
): Promise<ApiClientRecord> {
  const rows = queryRows<ApiClientRow>(
    await manager.query(
      `SELECT tenant_id, id, key_id, name, role, last_used_at, revoked_at, created_at
       FROM api_clients WHERE tenant_id = $1 AND id = $2`,
      [tenantId, apiClientId],
    ),
  );
  const row = rows[0];
  if (row === undefined) {
    throw new PersistenceConflictError(
      'IDEMPOTENCY_RESULT_INVALID',
      'Stored API client is missing',
    );
  }
  return mapApiClient(row);
}

@Injectable()
export class ApiClientStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async create(
    context: TenantContext,
    input: {
      readonly correlationId: string;
      readonly idempotencyKeyHash: string;
      readonly keyId: string;
      readonly name: string;
      readonly requestFingerprint: string;
      readonly role: ApiClientRole;
      readonly secretHash: string;
    },
  ): Promise<CreateApiClientStoreResult> {
    if (context.principalKind !== 'user') {
      throw new PersistenceConflictError(
        'AUTHORIZATION_DENIED',
        'A user administrator is required to create API clients',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const endpointScope = 'api-clients:create';
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
      const idempotencyRows = queryRows<ApiClientIdempotencyRow>(
        await manager.query(
          `SELECT request_fingerprint, principal_id, status, response_body
           FROM idempotency_records
           WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3
           FOR UPDATE`,
          [context.tenantId, endpointScope, input.idempotencyKeyHash],
        ),
      );
      const idempotency = idempotencyRows[0];
      if (
        idempotency === undefined ||
        idempotency.principal_id !== context.principalId ||
        idempotency.request_fingerprint !== input.requestFingerprint
      ) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_KEY_REUSE',
          'Idempotency key was already used for another API client',
        );
      }
      if (idempotency.status === 'completed') {
        const apiClientId = idempotency.response_body?.apiClientId;
        if (typeof apiClientId !== 'string') {
          throw new PersistenceConflictError(
            'IDEMPOTENCY_RESULT_INVALID',
            'Stored API client response is invalid',
          );
        }
        return {
          record: await readApiClient(manager, context.tenantId, apiClientId),
          replayed: true,
        };
      }
      const rows = queryRows<ApiClientRow>(
        await manager.query(
          `INSERT INTO api_clients
             (tenant_id, id, key_id, name, secret_hash, role, created_by_user_id)
           VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6)
           RETURNING tenant_id, id, key_id, name, role, last_used_at, revoked_at, created_at`,
          [
            context.tenantId,
            input.keyId,
            input.name,
            input.secretHash,
            input.role,
            context.principalId,
          ],
        ),
      );
      const created = rows[0];
      if (created === undefined) {
        throw new PersistenceConflictError('CONFLICT', 'API client could not be created');
      }
      await appendAuditEvent(manager, context, {
        eventType: 'api_client.created',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'api_client',
        resourceId: created.id,
        correlationId: input.correlationId,
        metadata: { keyId: input.keyId, name: input.name, role: input.role },
      });
      await manager.query(
        `UPDATE idempotency_records
         SET status = 'completed', response_status = 201,
             response_body = jsonb_build_object('apiClientId', $4::text),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
        [context.tenantId, endpointScope, input.idempotencyKeyHash, created.id],
      );
      return { record: mapApiClient(created), replayed: false };
    });
  }

  public async list(context: TenantContext): Promise<readonly ApiClientRecord[]> {
    const rows = queryRows<ApiClientRow>(
      await this.dataSource.query(
        `SELECT tenant_id, id, key_id, name, role, last_used_at, revoked_at, created_at
         FROM api_clients
         WHERE tenant_id = $1
         ORDER BY created_at DESC, id DESC`,
        [context.tenantId],
      ),
    );
    return rows.map(mapApiClient);
  }

  public async revoke(
    context: TenantContext,
    apiClientId: string,
    correlationId: string,
  ): Promise<ApiClientRecord> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<ApiClientRow>(
        await manager.query(
          `UPDATE api_clients
           SET revoked_at = COALESCE(revoked_at, clock_timestamp()), updated_at = clock_timestamp()
           WHERE tenant_id = $1 AND id = $2
           RETURNING tenant_id, id, key_id, name, role, last_used_at, revoked_at, created_at`,
          [context.tenantId, apiClientId],
        ),
      );
      const revoked = rows[0];
      if (revoked === undefined) {
        throw new PersistenceConflictError('NOT_FOUND', 'API client was not found');
      }
      await appendAuditEvent(manager, context, {
        eventType: 'api_client.revoked',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'api_client',
        resourceId: revoked.id,
        correlationId,
        metadata: { keyId: revoked.key_id },
      });
      return mapApiClient(revoked);
    });
  }

  public async findActiveCredential(
    tenantId: string,
    keyId: string,
  ): Promise<ApiClientCredentialRecord | null> {
    const rows = queryRows<ApiClientCredentialRow>(
      await this.dataSource.query(
        `SELECT client.tenant_id, client.id, client.role, client.secret_hash
         FROM api_clients client
         JOIN tenants tenant ON tenant.id = client.tenant_id
         WHERE client.tenant_id = $1 AND client.key_id = $2
           AND client.revoked_at IS NULL AND tenant.is_active = true`,
        [tenantId, keyId],
      ),
    );
    const credential = rows[0];
    return credential === undefined
      ? null
      : {
          id: credential.id,
          role: credential.role,
          secretHash: credential.secret_hash,
          tenantId: credential.tenant_id,
        };
  }

  public async markUsedIfActive(tenantId: string, apiClientId: string): Promise<boolean> {
    const rows = queryRows<{ id: string }>(
      await this.dataSource.query(
        `UPDATE api_clients
         SET last_used_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL
         RETURNING id`,
        [tenantId, apiClientId],
      ),
    );
    return rows.length === 1;
  }
}

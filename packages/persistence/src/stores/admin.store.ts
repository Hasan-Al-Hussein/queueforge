import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { JsonObject, TenantContext, TenantRole } from '@queueforge/contracts';

import { PersistenceConflictError } from '../errors.js';
import { withSerializableRetry } from '../transaction-retry.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';

interface IdempotencyResult {
  readonly responseBody: JsonObject | null;
}

interface IdempotentInput {
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
  readonly correlationId: string;
}

export interface CreateTenantInput extends IdempotentInput {
  readonly name: string;
  readonly slug: string;
}

export interface CreateMembershipInput extends IdempotentInput {
  readonly email: string;
  readonly role: TenantRole;
  readonly displayName?: string;
  readonly passwordHash?: string;
}

async function acquireIdempotency(
  manager: EntityManager,
  context: TenantContext,
  endpointScope: string,
  input: IdempotentInput,
): Promise<IdempotencyResult> {
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
  )) as unknown as Array<{
    request_fingerprint: string;
    principal_id: string;
    status: 'processing' | 'completed';
    response_body: JsonObject | null;
  }>;
  const record = rows[0];
  if (
    record === undefined ||
    record.request_fingerprint !== input.requestFingerprint ||
    record.principal_id !== context.principalId
  ) {
    throw new PersistenceConflictError(
      'IDEMPOTENCY_KEY_REUSE',
      'Idempotency key was already used for another operation',
    );
  }
  return { responseBody: record.status === 'completed' ? record.response_body : null };
}

async function completeIdempotency(
  manager: EntityManager,
  context: TenantContext,
  endpointScope: string,
  input: IdempotentInput,
  responseBody: JsonObject,
): Promise<void> {
  await manager.query(
    `UPDATE idempotency_records
     SET status = 'completed', response_status = 201, response_body = $4::jsonb,
         updated_at = clock_timestamp()
     WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
    [context.tenantId, endpointScope, input.idempotencyKeyHash, JSON.stringify(responseBody)],
  );
}

@Injectable()
export class AdminStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async createTenant(context: TenantContext, input: CreateTenantInput): Promise<JsonObject> {
    if (context.role !== 'platform_admin') {
      throw new PersistenceConflictError(
        'AUTHORIZATION_DENIED',
        'Platform administrator role is required',
      );
    }
    return withSerializableRetry(this.dataSource, async (manager) => {
      const endpointScope = 'platform:tenants:create';
      const idempotency = await acquireIdempotency(manager, context, endpointScope, input);
      if (idempotency.responseBody !== null) {
        return idempotency.responseBody;
      }
      const existing = (await manager.query(`SELECT id FROM tenants WHERE slug = $1 FOR SHARE`, [
        input.slug,
      ])) as unknown as Array<{ id: string }>;
      if (existing.length > 0) {
        throw new PersistenceConflictError('CONFLICT', 'Tenant slug is already in use');
      }
      const tenantId = randomUUID();
      await manager.query(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)`, [
        tenantId,
        input.slug,
        input.name,
      ]);
      await manager.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, 'tenant_admin')`,
        [tenantId, context.principalId],
      );
      await appendAuditEvent(
        manager,
        { ...context, tenantId },
        {
          eventType: 'tenant.created',
          actorPrincipalId: context.principalId,
          actorPrincipalKind: context.principalKind,
          resourceType: 'tenant',
          resourceId: tenantId,
          correlationId: input.correlationId,
          metadata: { slug: input.slug },
        },
      );
      const response: JsonObject = { tenantId, name: input.name, slug: input.slug };
      await completeIdempotency(manager, context, endpointScope, input, response);
      return response;
    });
  }

  public async createMembership(
    context: TenantContext,
    input: CreateMembershipInput,
  ): Promise<JsonObject> {
    if (context.role !== 'tenant_admin' && context.role !== 'platform_admin') {
      throw new PersistenceConflictError(
        'AUTHORIZATION_DENIED',
        'Tenant administrator role is required',
      );
    }
    return withSerializableRetry(this.dataSource, async (manager) => {
      const endpointScope = 'team:memberships:create';
      const idempotency = await acquireIdempotency(manager, context, endpointScope, input);
      if (idempotency.responseBody !== null) {
        return idempotency.responseBody;
      }
      const users = (await manager.query(
        `SELECT id, display_name FROM users WHERE lower(email) = lower($1) FOR UPDATE`,
        [input.email],
      )) as unknown as Array<{ id: string; display_name: string }>;
      let user = users[0];
      let createdUser = false;
      if (user === undefined) {
        if (
          input.displayName === undefined ||
          input.displayName.length === 0 ||
          input.passwordHash === undefined ||
          input.passwordHash.length === 0
        ) {
          throw new PersistenceConflictError(
            'CONFLICT',
            'displayName and initialPassword are required for a new user',
          );
        }
        user = { id: randomUUID(), display_name: input.displayName };
        await manager.query(
          `INSERT INTO users (id, email, display_name, password_hash)
           VALUES ($1, lower($2), $3, $4)`,
          [user.id, input.email, input.displayName, input.passwordHash],
        );
        createdUser = true;
      }
      const existingMembership = (await manager.query(
        `SELECT role, is_active FROM memberships
         WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
        [context.tenantId, user.id],
      )) as unknown as Array<{ role: TenantRole; is_active: boolean }>;
      if (existingMembership.length > 0) {
        throw new PersistenceConflictError('CONFLICT', 'User is already a tenant member');
      }
      await manager.query(
        `INSERT INTO memberships (tenant_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [context.tenantId, user.id, input.role],
      );
      const memberships = (await manager.query(
        `SELECT membership.created_at, membership.is_active
         FROM memberships membership
         WHERE membership.tenant_id = $1 AND membership.user_id = $2`,
        [context.tenantId, user.id],
      )) as unknown as Array<{ created_at: Date; is_active: boolean }>;
      const membership = memberships[0];
      if (membership === undefined) {
        throw new PersistenceConflictError(
          'CONFLICT',
          'Tenant membership could not be read after creation',
        );
      }
      await appendAuditEvent(manager, context, {
        eventType: 'membership.created',
        actorPrincipalId: context.principalId,
        actorPrincipalKind: context.principalKind,
        resourceType: 'membership',
        resourceId: user.id,
        correlationId: input.correlationId,
        metadata: { role: input.role, createdUser },
      });
      const response: JsonObject = {
        id: user.id,
        email: input.email.toLowerCase(),
        displayName: user.display_name,
        role: input.role,
        roleLocked: false,
        status: membership.is_active ? 'active' : 'disabled',
        joinedAt: membership.created_at.toISOString(),
      };
      await completeIdempotency(manager, context, endpointScope, input, response);
      return response;
    });
  }
}

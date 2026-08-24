import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { JsonObject, PrincipalKind } from '@queueforge/contracts';
import { sanitizeAuditMetadata } from '@queueforge/domain';

import { AuditEventEntity } from '../entities/index.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';

export interface AppendAuditInput {
  readonly eventType: string;
  readonly actorPrincipalId: string | null;
  readonly actorPrincipalKind: PrincipalKind;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly correlationId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export async function appendAuditEvent(
  manager: EntityManager,
  scope: TenantScope,
  input: AppendAuditInput,
): Promise<string> {
  const id = randomUUID();
  await manager.query(
    `INSERT INTO audit_events
       (tenant_id, id, event_type, actor_principal_id, actor_principal_kind,
        resource_type, resource_id, correlation_id, safe_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
    [
      requireTenantId(scope),
      id,
      input.eventType,
      input.actorPrincipalId,
      input.actorPrincipalKind,
      input.resourceType,
      input.resourceId,
      input.correlationId,
      JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {}) as JsonObject),
    ],
  );
  return id;
}

@Injectable()
export class AuditStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async append(scope: TenantScope, input: AppendAuditInput): Promise<string> {
    return appendAuditEvent(this.dataSource.manager, scope, input);
  }

  public async list(
    scope: TenantScope,
    page: number,
    pageSize: number,
  ): Promise<readonly AuditEventEntity[]> {
    return this.dataSource.getRepository(AuditEventEntity).find({
      where: { tenantId: requireTenantId(scope) },
      order: { occurredAt: 'DESC', id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
}

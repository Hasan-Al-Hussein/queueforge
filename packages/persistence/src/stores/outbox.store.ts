import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import { EVENT_SCHEMA_VERSION, type JsonObject } from '@queueforge/contracts';

import { queryRows } from '../query-result.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';

export interface AppendOutboxInput {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly payload: JsonObject;
  readonly availableAt?: Date;
  readonly maxAttempts?: number;
}

export interface ClaimedOutboxEvent {
  readonly tenantId: string;
  readonly id: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly schemaVersion: number;
  readonly payload: JsonObject;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseOwner: string;
  readonly leaseUntil: Date;
  readonly occurredAt: Date;
}

interface ClaimedOutboxRow {
  tenant_id: string;
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  schema_version: number;
  payload: JsonObject;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string;
  lease_until: Date;
  created_at: Date;
}

export async function appendOutboxEvent(
  manager: EntityManager,
  scope: TenantScope,
  input: AppendOutboxInput,
): Promise<string> {
  const id = randomUUID();
  await manager.query(
    `INSERT INTO outbox_events
       (tenant_id, id, event_type, aggregate_type, aggregate_id, correlation_id,
        schema_version, payload, status, attempt_count, max_attempts, available_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'pending', 0, $9, $10)`,
    [
      requireTenantId(scope),
      id,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      input.correlationId,
      EVENT_SCHEMA_VERSION,
      JSON.stringify(input.payload),
      input.maxAttempts ?? 10,
      input.availableAt ?? new Date(),
    ],
  );
  return id;
}

@Injectable()
export class OutboxStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async append(scope: TenantScope, input: AppendOutboxInput): Promise<string> {
    return appendOutboxEvent(this.dataSource.manager, scope, input);
  }

  public async recoverExpiredLeases(limit = 100): Promise<number> {
    const boundedLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
    const rows = queryRows<{ count: number }>(
      await this.dataSource.query(
        `WITH expired AS (
         SELECT tenant_id, id
         FROM outbox_events
         WHERE status = 'publishing' AND lease_until < clock_timestamp()
         ORDER BY lease_until, tenant_id, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       ), recovered AS (
         UPDATE outbox_events event
         SET status = CASE WHEN event.attempt_count >= event.max_attempts THEN 'dead' ELSE 'retry' END,
             lease_owner = NULL, lease_until = NULL,
             available_at = clock_timestamp(), updated_at = clock_timestamp(),
             last_error = 'dispatcher lease expired'
         FROM expired
         WHERE event.tenant_id = expired.tenant_id AND event.id = expired.id
         RETURNING event.tenant_id, event.id, event.attempt_count, event.status
       ), attempts AS (
         INSERT INTO outbox_attempts
           (tenant_id, id, outbox_event_id, attempt_no, outcome, worker_id, error_message)
         SELECT tenant_id, gen_random_uuid(), id, GREATEST(attempt_count, 1),
                'lease_expired', 'lease-recovery', 'dispatcher lease expired'
         FROM recovered
         ON CONFLICT DO NOTHING
       ), dead AS (
         INSERT INTO dead_letters
           (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
         SELECT tenant_id, gen_random_uuid(), 'outbox', id, 'open',
                'OUTBOX_LEASE_EXPIRED', 'dispatcher lease expired; attempts exhausted', attempt_count
         FROM recovered WHERE status = 'dead'
         ON CONFLICT DO NOTHING
       )
         SELECT count(*)::integer AS count FROM recovered`,
        [boundedLimit],
      ),
    );
    return rows[0]?.count ?? 0;
  }

  public async releaseOwnerLeases(
    leaseOwner: string,
    reason = 'dispatcher shutdown',
  ): Promise<number> {
    const rows = queryRows<{ count: number }>(
      await this.dataSource.query(
        `WITH released AS (
         UPDATE outbox_events
         SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'retry' END,
             lease_owner = NULL, lease_until = NULL,
             available_at = clock_timestamp(), updated_at = clock_timestamp(),
             last_error = left($2, 2000)
         WHERE status = 'publishing' AND lease_owner = $1
         RETURNING tenant_id, id, attempt_count, status
       ), attempts AS (
         INSERT INTO outbox_attempts
           (tenant_id, id, outbox_event_id, attempt_no, outcome, worker_id, error_message)
         SELECT tenant_id, gen_random_uuid(), id, GREATEST(attempt_count, 1),
                'lease_expired', $1, left($2, 2000)
         FROM released
         ON CONFLICT DO NOTHING
       ), dead AS (
         INSERT INTO dead_letters
           (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
         SELECT tenant_id, gen_random_uuid(), 'outbox', id, 'open',
                'OUTBOX_OWNER_RELEASED_AT_LIMIT', left($2, 2000), attempt_count
         FROM released WHERE status = 'dead'
         ON CONFLICT DO NOTHING
       )
         SELECT count(*)::integer AS count FROM released`,
        [leaseOwner, reason],
      ),
    );
    return rows[0]?.count ?? 0;
  }

  public async claimBatch(
    leaseOwner: string,
    leaseSeconds: number,
    limit = 25,
  ): Promise<readonly ClaimedOutboxEvent[]> {
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const boundedLease = Math.min(300, Math.max(5, Math.trunc(leaseSeconds)));
    const rows = queryRows<ClaimedOutboxRow>(
      await this.dataSource.query(
        `WITH candidates AS (
         SELECT tenant_id, id
         FROM outbox_events
         WHERE status IN ('pending','retry')
           AND available_at <= clock_timestamp()
           AND attempt_count < max_attempts
         ORDER BY available_at, created_at, tenant_id, id
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       ), claimed AS (
         UPDATE outbox_events event
         SET status = 'publishing', lease_owner = $2,
             lease_until = clock_timestamp() + ($3 * interval '1 second'),
             attempt_count = event.attempt_count + 1,
             updated_at = clock_timestamp(), last_error = NULL
         FROM candidates
         WHERE event.tenant_id = candidates.tenant_id AND event.id = candidates.id
         RETURNING event.*
       ), attempts AS (
         INSERT INTO outbox_attempts
           (tenant_id, id, outbox_event_id, attempt_no, outcome, worker_id)
         SELECT tenant_id, gen_random_uuid(), id, attempt_count, 'claimed', $2 FROM claimed
       )
         SELECT * FROM claimed`,
        [boundedLimit, leaseOwner, boundedLease],
      ),
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      id: row.id,
      eventType: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      correlationId: row.correlation_id,
      schemaVersion: row.schema_version,
      payload: row.payload,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      leaseOwner: row.lease_owner,
      leaseUntil: row.lease_until,
      occurredAt: row.created_at,
    }));
  }

  public async markPublished(
    tenantId: string,
    eventId: string,
    leaseOwner: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ attempt_count: number }>(
        await manager.query(
          `UPDATE outbox_events
         SET status = 'published', published_at = clock_timestamp(),
             lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status = 'publishing' AND lease_owner = $3
         RETURNING attempt_count`,
          [tenantId, eventId, leaseOwner],
        ),
      );
      const attempt = rows[0];
      if (attempt === undefined) {
        return false;
      }
      await manager.query(
        `INSERT INTO outbox_attempts
           (tenant_id, id, outbox_event_id, attempt_no, outcome, worker_id)
         VALUES ($1, gen_random_uuid(), $2, $3, 'published', $4)`,
        [tenantId, eventId, attempt.attempt_count, leaseOwner],
      );
      return true;
    });
  }

  public async markFailed(
    tenantId: string,
    eventId: string,
    leaseOwner: string,
    errorMessage: string,
    retryAt: Date,
  ): Promise<'retry' | 'dead' | 'stale_lease'> {
    return this.dataSource.transaction(async (manager) => {
      const rows = queryRows<{ attempt_count: number; status: 'retry' | 'dead' }>(
        await manager.query(
          `UPDATE outbox_events
         SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead' ELSE 'retry' END,
             available_at = CASE WHEN attempt_count >= max_attempts THEN available_at ELSE $4 END,
             lease_owner = NULL, lease_until = NULL, updated_at = clock_timestamp(),
             last_error = left($5, 2000)
         WHERE tenant_id = $1 AND id = $2 AND status = 'publishing' AND lease_owner = $3
         RETURNING attempt_count, status`,
          [tenantId, eventId, leaseOwner, retryAt, errorMessage],
        ),
      );
      const event = rows[0];
      if (event === undefined) {
        return 'stale_lease';
      }
      await manager.query(
        `INSERT INTO outbox_attempts
           (tenant_id, id, outbox_event_id, attempt_no, outcome, worker_id, error_message)
         VALUES ($1, gen_random_uuid(), $2, $3, 'failed', $4, left($5, 2000))`,
        [tenantId, eventId, event.attempt_count, leaseOwner, errorMessage],
      );
      if (event.status === 'dead') {
        await manager.query(
          `INSERT INTO dead_letters
             (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
           VALUES ($1, gen_random_uuid(), 'outbox', $2, 'open', 'OUTBOX_PUBLISH_EXHAUSTED', left($3, 2000), $4)
           ON CONFLICT DO NOTHING`,
          [tenantId, eventId, errorMessage, event.attempt_count],
        );
      }
      return event.status;
    });
  }
}

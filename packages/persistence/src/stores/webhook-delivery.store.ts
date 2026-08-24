import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import type { JsonObject, PrincipalKind } from '@queueforge/contracts';

import { PersistenceConflictError, PersistenceNotFoundError } from '../errors.js';
import { queryRows } from '../query-result.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';
import { appendAuditEvent } from './audit.store.js';
import { deleteExpiredIdempotencyRecord } from './idempotency-record.js';
import { appendOutboxEvent } from './outbox.store.js';
import { insertProcessedEvent } from './processed-event.store.js';

export interface WebhookDeliveryRecord {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly generation: number;
  readonly targetUrl: string;
  readonly payload: JsonObject;
  readonly keyId: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
}

interface WebhookDeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  generation: number;
  target_url: string;
  payload_snapshot: JsonObject;
  key_id: string;
  attempt_count: number;
  max_attempts: number;
}

export interface WebhookAttemptResult {
  readonly responseStatus?: number;
  readonly responseBodyExcerpt?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly durationMs: number;
  readonly retryAt?: Date;
  readonly terminal?: boolean;
}

export interface WebhookRecoveryReceipt {
  readonly consumer: string;
  readonly eventId: string;
}

export type WebhookClaimResult =
  WebhookDeliveryRecord | { readonly deadLettered: true } | { readonly duplicate: true } | null;

async function recordWebhookAttemptInTransaction(
  manager: EntityManager,
  tenantId: string,
  deliveryId: string,
  attemptNo: number,
  result: WebhookAttemptResult,
): Promise<'delivered' | 'retry' | 'dead'> {
  const rows = (await manager.query(
    `SELECT attempt_count, max_attempts, event_id,
            payload_snapshot->>'correlationId' AS correlation_id
     FROM webhook_deliveries
     WHERE tenant_id = $1 AND id = $2 AND status = 'delivering'
     FOR UPDATE`,
    [tenantId, deliveryId],
  )) as unknown as Array<{
    attempt_count: number;
    correlation_id: string | null;
    event_id: string;
    max_attempts: number;
  }>;
  const delivery = rows[0];
  if (delivery === undefined) {
    throw new PersistenceNotFoundError('claimed webhook delivery');
  }
  if (delivery.attempt_count !== attemptNo) {
    throw new PersistenceConflictError('STALE_ATTEMPT', 'Webhook attempt is stale');
  }
  const delivered =
    result.responseStatus !== undefined &&
    result.responseStatus >= 200 &&
    result.responseStatus < 300;
  const status: 'delivered' | 'retry' | 'dead' = delivered
    ? 'delivered'
    : result.terminal === true || attemptNo >= delivery.max_attempts
      ? 'dead'
      : 'retry';
  await manager.query(
    `INSERT INTO webhook_delivery_attempts
       (tenant_id, id, delivery_id, attempt_no, response_status, response_body_excerpt,
        error_code, error_message, duration_ms)
     VALUES ($1, $2, $3, $4, $5, left($6, 2000), $7, left($8, 2000), $9)`,
    [
      tenantId,
      randomUUID(),
      deliveryId,
      attemptNo,
      result.responseStatus ?? null,
      result.responseBodyExcerpt ?? null,
      result.errorCode ?? null,
      result.errorMessage ?? null,
      result.durationMs,
    ],
  );
  await manager.query(
    `UPDATE webhook_deliveries
     SET status = $3, delivered_at = CASE WHEN $3 = 'delivered' THEN clock_timestamp() ELSE NULL END,
         next_attempt_at = COALESCE($4, next_attempt_at),
         lease_owner = NULL, lease_until = NULL,
         last_error = CASE WHEN $3 = 'delivered' THEN NULL ELSE left(COALESCE($5, 'delivery failed'), 2000) END,
         updated_at = clock_timestamp()
     WHERE tenant_id = $1 AND id = $2`,
    [
      tenantId,
      deliveryId,
      status,
      result.retryAt ?? null,
      result.errorMessage ?? result.errorCode ?? null,
    ],
  );
  if (status === 'dead') {
    await manager.query(
      `INSERT INTO dead_letters
         (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
       VALUES ($1, gen_random_uuid(), 'webhook', $2, 'open', $3, left($4, 2000), $5)
       ON CONFLICT DO NOTHING`,
      [
        tenantId,
        deliveryId,
        result.errorCode ?? 'WEBHOOK_EXHAUSTED',
        result.errorMessage ?? 'Webhook attempts exhausted',
        attemptNo,
      ],
    );
  }
  await appendAuditEvent(
    manager,
    { tenantId },
    {
      eventType:
        status === 'delivered'
          ? 'webhook.delivery.delivered'
          : status === 'retry'
            ? 'webhook.delivery.retry_scheduled'
            : 'webhook.delivery.dead_lettered',
      actorPrincipalId: null,
      actorPrincipalKind: 'system',
      resourceType: 'webhook_delivery',
      resourceId: deliveryId,
      correlationId: delivery.correlation_id ?? delivery.event_id,
      metadata: {
        attemptNo,
        deliveryStatus: status,
        eventId: delivery.event_id,
        ...(result.responseStatus === undefined ? {} : { responseStatus: result.responseStatus }),
        ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
      },
    },
  );
  return status;
}

export interface ReplayWebhookInput {
  readonly actorPrincipalId: string;
  readonly actorPrincipalKind: PrincipalKind;
  readonly correlationId: string;
  readonly idempotencyKeyHash: string;
  readonly requestFingerprint: string;
}

@Injectable()
export class WebhookDeliveryStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async claim(
    scope: TenantScope,
    deliveryId: string,
    leaseOwner = 'queueforge-worker',
    leaseSeconds = 30,
  ): Promise<WebhookDeliveryRecord | null> {
    const result = await this.claimOrRecover(scope, deliveryId, leaseOwner, leaseSeconds);
    return result !== null && 'id' in result ? result : null;
  }

  public async claimOrRecover(
    scope: TenantScope,
    deliveryId: string,
    leaseOwner: string,
    leaseSeconds: number,
    terminalReceipt?: WebhookRecoveryReceipt,
  ): Promise<WebhookClaimResult> {
    const tenantId = requireTenantId(scope);
    const boundedLease = Math.min(300, Math.max(5, Math.trunc(leaseSeconds)));
    return this.dataSource.transaction(async (manager) => {
      if (terminalReceipt !== undefined) {
        const existing = (await manager.query(
          `SELECT 1 FROM processed_events
           WHERE tenant_id = $1 AND consumer = $2 AND event_id = $3`,
          [tenantId, terminalReceipt.consumer, terminalReceipt.eventId],
        )) as unknown as Array<{ '?column?': number }>;
        if (existing.length > 0) {
          return { duplicate: true };
        }
      }
      const currentRows = (await manager.query(
        `SELECT status, attempt_count, max_attempts, lease_until, event_id,
                payload_snapshot->>'correlationId' AS correlation_id
         FROM webhook_deliveries WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, deliveryId],
      )) as unknown as Array<{
        status: 'pending' | 'delivering' | 'retry' | 'delivered' | 'dead';
        attempt_count: number;
        correlation_id: string | null;
        event_id: string;
        max_attempts: number;
        lease_until: Date | null;
      }>;
      const current = currentRows[0];
      if (current === undefined) {
        return null;
      }
      if (current.status === 'dead') {
        if (terminalReceipt !== undefined) {
          await insertProcessedEvent(
            manager,
            tenantId,
            terminalReceipt.consumer,
            terminalReceipt.eventId,
          );
        }
        return { deadLettered: true };
      }
      if (current.status === 'delivered') {
        if (terminalReceipt !== undefined) {
          await insertProcessedEvent(
            manager,
            tenantId,
            terminalReceipt.consumer,
            terminalReceipt.eventId,
          );
        }
        return { duplicate: true };
      }
      if (current.status === 'delivering') {
        if (current.lease_until !== null && current.lease_until > new Date()) {
          return null;
        }
        await manager.query(
          `INSERT INTO webhook_delivery_attempts
             (tenant_id, id, delivery_id, attempt_no, error_code, error_message, duration_ms)
           VALUES ($1, gen_random_uuid(), $2, $3, 'DELIVERY_LEASE_EXPIRED',
                   'delivery worker lease expired; outcome unknown', 0)
           ON CONFLICT (tenant_id, delivery_id, attempt_no) DO NOTHING`,
          [tenantId, deliveryId, current.attempt_count],
        );
        if (current.attempt_count >= current.max_attempts) {
          await manager.query(
            `UPDATE webhook_deliveries
             SET status = 'dead', lease_owner = NULL, lease_until = NULL,
                 last_error = 'delivery worker lease expired; attempts exhausted',
                 updated_at = clock_timestamp()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, deliveryId],
          );
          await manager.query(
            `INSERT INTO dead_letters
               (tenant_id, id, resource_kind, resource_id, status, reason_code, reason_message, attempt_count)
             VALUES ($1, gen_random_uuid(), 'webhook', $2, 'open', 'DELIVERY_LEASE_EXPIRED',
                     'delivery worker lease expired; attempts exhausted', $3)
             ON CONFLICT DO NOTHING`,
            [tenantId, deliveryId, current.attempt_count],
          );
          await appendAuditEvent(
            manager,
            { tenantId },
            {
              eventType: 'webhook.delivery.dead_lettered',
              actorPrincipalId: null,
              actorPrincipalKind: 'system',
              resourceType: 'webhook_delivery',
              resourceId: deliveryId,
              correlationId: current.correlation_id ?? current.event_id,
              metadata: {
                attemptNo: current.attempt_count,
                deliveryStatus: 'dead',
                errorCode: 'DELIVERY_LEASE_EXPIRED',
                eventId: current.event_id,
              },
            },
          );
          if (
            terminalReceipt !== undefined &&
            !(await insertProcessedEvent(
              manager,
              tenantId,
              terminalReceipt.consumer,
              terminalReceipt.eventId,
            ))
          ) {
            throw new PersistenceConflictError(
              'PROCESSED_EVENT_RACE',
              'Expired webhook event was completed concurrently',
            );
          }
          return { deadLettered: true };
        }
        await manager.query(
          `UPDATE webhook_deliveries
           SET status = 'retry', lease_owner = NULL, lease_until = NULL,
               next_attempt_at = clock_timestamp(), updated_at = clock_timestamp(),
               last_error = 'delivery worker lease expired; retrying with stable event id'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, deliveryId],
        );
        await appendAuditEvent(
          manager,
          { tenantId },
          {
            eventType: 'webhook.delivery.retry_scheduled',
            actorPrincipalId: null,
            actorPrincipalKind: 'system',
            resourceType: 'webhook_delivery',
            resourceId: deliveryId,
            correlationId: current.correlation_id ?? current.event_id,
            metadata: {
              attemptNo: current.attempt_count,
              deliveryStatus: 'retry',
              errorCode: 'DELIVERY_LEASE_EXPIRED',
              eventId: current.event_id,
            },
          },
        );
      }
      const rows = queryRows<WebhookDeliveryRow>(
        await manager.query(
          `UPDATE webhook_deliveries
         SET status = 'delivering', attempt_count = attempt_count + 1,
             lease_owner = $3,
             lease_until = clock_timestamp() + ($4 * interval '1 second'),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND id = $2 AND status IN ('pending','retry')
           AND next_attempt_at <= clock_timestamp() AND attempt_count < max_attempts
         RETURNING id, endpoint_id, event_id, generation, target_url, payload_snapshot,
                   key_id, attempt_count, max_attempts`,
          [tenantId, deliveryId, leaseOwner, boundedLease],
        ),
      );
      const row = rows[0];
      return row !== undefined
        ? {
            id: row.id,
            endpointId: row.endpoint_id,
            eventId: row.event_id,
            generation: row.generation,
            targetUrl: row.target_url,
            payload: row.payload_snapshot,
            keyId: row.key_id,
            attemptCount: row.attempt_count,
            maxAttempts: row.max_attempts,
          }
        : null;
    });
  }

  public async recordAttempt(
    scope: TenantScope,
    deliveryId: string,
    attemptNo: number,
    result: WebhookAttemptResult,
  ): Promise<'delivered' | 'retry' | 'dead'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      return recordWebhookAttemptInTransaction(manager, tenantId, deliveryId, attemptNo, result);
    });
  }

  public async recordAttemptOnce(
    scope: TenantScope,
    eventId: string,
    consumer: string,
    deliveryId: string,
    attemptNo: number,
    result: WebhookAttemptResult,
  ): Promise<'delivered' | 'retry' | 'dead' | 'duplicate'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      const existing = (await manager.query(
        `SELECT 1 FROM processed_events
         WHERE tenant_id = $1 AND consumer = $2 AND event_id = $3`,
        [tenantId, consumer, eventId],
      )) as unknown as Array<{ '?column?': number }>;
      if (existing.length > 0) {
        return 'duplicate';
      }
      const status = await recordWebhookAttemptInTransaction(
        manager,
        tenantId,
        deliveryId,
        attemptNo,
        result,
      );
      if (status !== 'retry') {
        if (!(await insertProcessedEvent(manager, tenantId, consumer, eventId))) {
          throw new PersistenceConflictError(
            'PROCESSED_EVENT_RACE',
            'Webhook event was completed concurrently',
          );
        }
      }
      return status;
    });
  }

  public async createReplay(
    scope: TenantScope,
    deliveryId: string,
    input: ReplayWebhookInput,
  ): Promise<string> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      const endpointScope = `webhook-delivery:${deliveryId}:replay`;
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
          input.actorPrincipalId,
          input.actorPrincipalKind,
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
        idempotency.principal_id !== input.actorPrincipalId
      ) {
        throw new PersistenceConflictError(
          'IDEMPOTENCY_KEY_REUSE',
          'Idempotency key was already used for a different replay',
        );
      }
      if (idempotency.status === 'completed') {
        const replayId = idempotency.response_body?.deliveryId;
        if (typeof replayId !== 'string') {
          throw new PersistenceConflictError(
            'IDEMPOTENCY_RESULT_INVALID',
            'Stored webhook replay result is incomplete',
          );
        }
        return replayId;
      }
      const rows = (await manager.query(
        `SELECT endpoint_id, event_id, generation, target_url, payload_snapshot, key_id, max_attempts
         FROM webhook_deliveries WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, deliveryId],
      )) as unknown as Array<WebhookDeliveryRow & { max_attempts: number }>;
      const previous = rows[0];
      if (previous === undefined) {
        throw new PersistenceNotFoundError('webhook delivery');
      }
      const id = randomUUID();
      await manager.query(
        `INSERT INTO webhook_deliveries
           (tenant_id, id, endpoint_id, event_id, generation, target_url, payload_snapshot,
            key_id, status, attempt_count, max_attempts, next_attempt_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending', 0, $9, clock_timestamp())`,
        [
          tenantId,
          id,
          previous.endpoint_id,
          previous.event_id,
          previous.generation + 1,
          previous.target_url,
          JSON.stringify(previous.payload_snapshot),
          previous.key_id,
          previous.max_attempts,
        ],
      );
      await appendAuditEvent(manager, scope, {
        eventType: 'webhook.delivery_replayed',
        actorPrincipalId: input.actorPrincipalId,
        actorPrincipalKind: input.actorPrincipalKind,
        resourceType: 'webhook_delivery',
        resourceId: id,
        correlationId: input.correlationId,
        metadata: { previousDeliveryId: deliveryId, eventId: previous.event_id },
      });
      await appendOutboxEvent(manager, scope, {
        eventType: 'webhook.delivery.requested',
        aggregateType: 'webhook_delivery',
        aggregateId: id,
        correlationId: input.correlationId,
        payload: { deliveryId: id, replayOfDeliveryId: deliveryId },
      });
      await manager.query(
        `UPDATE dead_letters
         SET status = 'requeued', requeued_by_principal_id = $3,
             requeued_at = clock_timestamp(), updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND resource_kind = 'webhook' AND resource_id = $2
           AND status = 'open'`,
        [tenantId, deliveryId, input.actorPrincipalId],
      );
      await manager.query(
        `UPDATE idempotency_records
         SET status = 'completed', response_status = 201,
             response_body = jsonb_build_object('deliveryId', $4::text),
             updated_at = clock_timestamp()
         WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3`,
        [tenantId, endpointScope, input.idempotencyKeyHash, id],
      );
      return id;
    });
  }
}

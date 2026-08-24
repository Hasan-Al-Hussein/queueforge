import type { EntityManager } from 'typeorm';

export async function deleteExpiredIdempotencyRecord(
  manager: EntityManager,
  tenantId: string,
  endpointScope: string,
  keyHash: string,
): Promise<void> {
  await manager.query(
    `DELETE FROM idempotency_records
     WHERE tenant_id = $1 AND endpoint_scope = $2 AND key_hash = $3
       AND expires_at <= clock_timestamp()`,
    [tenantId, endpointScope, keyHash],
  );
  await manager.query(
    `WITH expired AS (
       SELECT record.ctid
       FROM idempotency_records record
       WHERE record.tenant_id = $1 AND record.expires_at <= clock_timestamp()
       ORDER BY record.expires_at, record.id
       FOR UPDATE SKIP LOCKED
       LIMIT 100
     )
     DELETE FROM idempotency_records record
     USING expired
     WHERE record.ctid = expired.ctid`,
    [tenantId],
  );
}

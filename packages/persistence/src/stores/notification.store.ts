import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import { queryRows } from '../query-result.js';
import { requireTenantId, type TenantScope } from '../tenant-scope.js';
import { insertProcessedEvent } from './processed-event.store.js';

export interface NotificationRecord {
  readonly id: string;
  readonly recipientKind: 'user' | 'role';
  readonly recipientRef: string;
  readonly title: string;
  readonly body: string;
  readonly status: 'pending' | 'delivered' | 'failed';
}

async function recordNotificationDeliveryInTransaction(
  manager: EntityManager,
  tenantId: string,
  notificationId: string,
  provider: 'in_app' | 'console',
  outcome: { readonly delivered: boolean; readonly errorMessage?: string },
): Promise<boolean> {
  const status = outcome.delivered ? 'delivered' : 'failed';
  const inserted = queryRows<{ id: string }>(
    await manager.query(
      `INSERT INTO notification_deliveries
       (tenant_id, id, notification_id, provider, status, error_message, delivered_at)
     VALUES ($1, $2, $3, $4, $5, left($6, 2000), CASE WHEN $5 = 'delivered' THEN clock_timestamp() ELSE NULL END)
     ON CONFLICT (tenant_id, notification_id, provider) DO NOTHING
     RETURNING id`,
      [tenantId, randomUUID(), notificationId, provider, status, outcome.errorMessage ?? null],
    ),
  );
  if (inserted.length === 0) {
    return false;
  }
  await manager.query(
    `UPDATE notifications SET status = $3, updated_at = clock_timestamp()
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, notificationId, status],
  );
  return true;
}

@Injectable()
export class NotificationStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async get(scope: TenantScope, notificationId: string): Promise<NotificationRecord | null> {
    const tenantId = requireTenantId(scope);
    const rows = (await this.dataSource.query(
      `SELECT id, recipient_kind, recipient_ref, title, body, status
       FROM notifications WHERE tenant_id = $1 AND id = $2`,
      [tenantId, notificationId],
    )) as unknown as Array<{
      id: string;
      recipient_kind: 'user' | 'role';
      recipient_ref: string;
      title: string;
      body: string;
      status: 'pending' | 'delivered' | 'failed';
    }>;
    const row = rows[0];
    return row !== undefined
      ? {
          id: row.id,
          recipientKind: row.recipient_kind,
          recipientRef: row.recipient_ref,
          title: row.title,
          body: row.body,
          status: row.status,
        }
      : null;
  }

  public async recordDelivery(
    scope: TenantScope,
    notificationId: string,
    provider: 'in_app' | 'console',
    outcome: { readonly delivered: boolean; readonly errorMessage?: string },
  ): Promise<boolean> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      return recordNotificationDeliveryInTransaction(
        manager,
        tenantId,
        notificationId,
        provider,
        outcome,
      );
    });
  }

  public async recordDeliveryOnce(
    scope: TenantScope,
    eventId: string,
    consumer: string,
    notificationId: string,
    provider: 'in_app' | 'console',
    outcome: { readonly delivered: boolean; readonly errorMessage?: string },
  ): Promise<'processed' | 'duplicate'> {
    const tenantId = requireTenantId(scope);
    return this.dataSource.transaction(async (manager) => {
      if (!(await insertProcessedEvent(manager, tenantId, consumer, eventId))) {
        return 'duplicate';
      }
      await recordNotificationDeliveryInTransaction(
        manager,
        tenantId,
        notificationId,
        provider,
        outcome,
      );
      return 'processed';
    });
  }
}

import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';

import { queryRows } from '../query-result.js';

@Injectable()
export class ProcessedEventStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async runOnce(
    tenantId: string,
    consumer: string,
    eventId: string,
    effect: (manager: EntityManager) => Promise<void>,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = queryRows<{ event_id: string }>(
        await manager.query(
          `INSERT INTO processed_events (tenant_id, consumer, event_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING event_id`,
          [tenantId, consumer, eventId],
        ),
      );
      if (inserted.length === 0) {
        return false;
      }
      await effect(manager);
      return true;
    });
  }

  public async has(tenantId: string, consumer: string, eventId: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM processed_events
       WHERE tenant_id = $1 AND consumer = $2 AND event_id = $3`,
      [tenantId, consumer, eventId],
    )) as unknown as Array<{ '?column?': number }>;
    return rows.length > 0;
  }
}

export async function insertProcessedEvent(
  manager: EntityManager,
  tenantId: string,
  consumer: string,
  eventId: string,
): Promise<boolean> {
  const inserted = queryRows<{ event_id: string }>(
    await manager.query(
      `INSERT INTO processed_events (tenant_id, consumer, event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING event_id`,
      [tenantId, consumer, eventId],
    ),
  );
  return inserted.length > 0;
}

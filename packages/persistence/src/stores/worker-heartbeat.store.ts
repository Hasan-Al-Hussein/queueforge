import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { JsonObject } from '@queueforge/contracts';

@Injectable()
export class WorkerHeartbeatStore {
  public constructor(private readonly dataSource: DataSource) {}

  public async beat(
    workerId: string,
    service: string,
    version: string,
    startedAt: Date,
    metadata: JsonObject = {},
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO worker_nodes (id, service, version, started_at, heartbeat_at, metadata)
       VALUES ($1, $2, $3, $4, clock_timestamp(), $5::jsonb)
       ON CONFLICT (id) DO UPDATE
         SET heartbeat_at = EXCLUDED.heartbeat_at,
             service = EXCLUDED.service,
             version = EXCLUDED.version,
             metadata = EXCLUDED.metadata`,
      [workerId, service, version, startedAt, JSON.stringify(metadata)],
    );
  }

  public async remove(workerId: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM worker_nodes WHERE id = $1`, [workerId]);
  }
}

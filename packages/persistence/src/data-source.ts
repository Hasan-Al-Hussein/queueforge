import { DataSource, type DataSourceOptions } from 'typeorm';

import { persistenceEntities } from './entities/index.js';
import { persistenceMigrations } from './migrations/index.js';

export interface QueueForgeDataSourceOptions {
  readonly databaseUrl: string;
  readonly applicationName?: string;
  readonly includeMigrations?: boolean;
  readonly logging?: boolean;
}

export function queueForgeDataSourceOptions(
  options: QueueForgeDataSourceOptions,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: options.databaseUrl,
    applicationName: options.applicationName ?? 'queueforge',
    entities: [...persistenceEntities],
    migrations: options.includeMigrations === false ? [] : [...persistenceMigrations],
    synchronize: false,
    migrationsRun: false,
    logging: options.logging ?? false,
    extra: {
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    },
  };
}

export function createQueueForgeDataSource(options: QueueForgeDataSourceOptions): DataSource {
  return new DataSource(queueForgeDataSourceOptions(options));
}

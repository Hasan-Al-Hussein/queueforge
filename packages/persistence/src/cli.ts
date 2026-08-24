import 'reflect-metadata';

import {
  loadMigrationEnvironment,
  loadSeedEnvironment,
  type MigrationEnvironment,
} from '@queueforge/config';

import { createQueueForgeDataSource } from './data-source.js';
import { seedQueueForge } from './seed.js';

async function withDataSource(
  environment: MigrationEnvironment,
  operation: (dataSource: ReturnType<typeof createQueueForgeDataSource>) => Promise<void>,
): Promise<void> {
  const migrationUrl = environment.MIGRATION_DATABASE_URL ?? environment.DATABASE_URL;
  const dataSource = createQueueForgeDataSource({
    databaseUrl: migrationUrl,
    applicationName: 'queueforge-migrations',
  });
  await dataSource.initialize();
  try {
    await operation(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'seed') {
    const environment = loadSeedEnvironment();
    await withDataSource(environment, (dataSource) => seedQueueForge(dataSource, environment));
    return;
  }
  const environment = loadMigrationEnvironment();
  if (command === 'migrate') {
    await withDataSource(environment, (dataSource) =>
      dataSource.runMigrations({ transaction: 'all' }).then(() => undefined),
    );
    return;
  }
  if (command === 'revert') {
    await withDataSource(environment, (dataSource) =>
      dataSource.undoLastMigration({ transaction: 'all' }).then(() => undefined),
    );
    return;
  }
  throw new Error('Usage: tsx src/cli.ts <migrate|revert|seed>');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown persistence command failure';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { loadWorkerEnvironment } from '@queueforge/config';
import { StructuredLogger } from '@queueforge/observability';

import { safeErrorMessage } from './core/errors.js';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const environment = loadWorkerEnvironment();
  const application = await NestFactory.createApplicationContext(
    WorkerModule.register(environment),
    { bufferLogs: true },
  );
  application.useLogger(application.get(StructuredLogger));
  application.flushLogs();
  application.enableShutdownHooks(['SIGINT', 'SIGTERM']);
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'worker.start_failed', message: safeErrorMessage(error) })}\n`,
  );
  process.exitCode = 1;
});

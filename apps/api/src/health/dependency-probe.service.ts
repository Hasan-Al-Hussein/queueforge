import { createConnection } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import { OperationsService, RUNTIME_ENVIRONMENT } from '@queueforge/application';
import type { RuntimeEnvironment } from '@queueforge/config';
import { MetricsService } from '@queueforge/observability';

const PROBE_TIMEOUT_MS = 1_500;

function redisCommand(parts: readonly string[]): string {
  return `*${String(parts.length)}\r\n${parts
    .map((part) => `$${String(Buffer.byteLength(part, 'utf8'))}\r\n${part}\r\n`)
    .join('')}`;
}

async function pingRedis(redisUrl: string): Promise<void> {
  const target = new URL(redisUrl);
  const port = target.port === '' ? 6379 : Number(target.port);
  const password = decodeURIComponent(target.password);
  const username = decodeURIComponent(target.username);
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: target.hostname, port });
    let settled = false;
    let response = '';
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve();
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(new Error('Redis readiness timed out')));
    socket.once('error', (error) => finish(error));
    socket.on('data', (chunk: Buffer) => {
      response += chunk.toString('utf8');
      if (response.includes('-')) {
        finish(new Error('Redis readiness command failed'));
      } else if (response.includes('+PONG\r\n')) {
        finish();
      }
    });
    socket.once('connect', () => {
      if (password !== '') {
        socket.write(
          redisCommand(username === '' ? ['AUTH', password] : ['AUTH', username, password]),
        );
      }
      socket.write(redisCommand(['PING']));
    });
  });
}

@Injectable()
export class DependencyProbeService {
  public constructor(
    private readonly operations: OperationsService,
    private readonly metrics: MetricsService,
    @Inject(RUNTIME_ENVIRONMENT) private readonly environment: RuntimeEnvironment,
  ) {}

  public async readiness(): Promise<{
    readonly database: 'ready' | 'unavailable';
    readonly redis: 'ready' | 'unavailable';
    readonly ready: boolean;
  }> {
    const [database, redis] = await Promise.allSettled([
      this.operations.databaseReady(),
      pingRedis(this.environment.REDIS_URL),
    ]);
    const databaseReady = database.status === 'fulfilled';
    const redisReady = redis.status === 'fulfilled';
    this.metrics.dependencyReady.set({ dependency: 'postgresql' }, databaseReady ? 1 : 0);
    this.metrics.dependencyReady.set({ dependency: 'redis' }, redisReady ? 1 : 0);
    return {
      database: databaseReady ? 'ready' : 'unavailable',
      redis: redisReady ? 'ready' : 'unavailable',
      ready: databaseReady && redisReady,
    };
  }
}

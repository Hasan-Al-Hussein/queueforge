import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { MetricsService } from './metrics.service.js';

export interface ObservabilityOptions {
  readonly serviceName: string;
  readonly environment: 'development' | 'test' | 'production';
  readonly logLevel?: string;
}

export const SENSITIVE_LOG_PATHS = Object.freeze([
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'req.headers["x-csrf-token"]',
  'req.headers["x-queueforge-signature"]',
  'req.body.accessToken',
  'req.body.apiKey',
  'req.body.initialPassword',
  'req.body.password',
  'req.body.refreshToken',
  'req.body.secret',
  'req.body.variables.accessToken',
  'req.body.variables.apiKey',
  'req.body.variables.idempotencyKey',
  'req.body.variables.initialPassword',
  'req.body.variables.password',
  'req.body.variables.refreshToken',
  'res.headers.set-cookie',
]);

@Module({})
export class ObservabilityModule {
  public static forRoot(options: ObservabilityOptions): DynamicModule {
    const pretty = options.environment === 'development';
    return {
      module: ObservabilityModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: options.logLevel ?? (options.environment === 'production' ? 'info' : 'debug'),
            base: { service: options.serviceName },
            redact: {
              paths: [...SENSITIVE_LOG_PATHS],
              censor: '[REDACTED]',
            },
            ...(pretty
              ? {
                  transport: {
                    target: 'pino-pretty',
                    options: { colorize: true, singleLine: true },
                  },
                }
              : {}),
          },
        }),
      ],
      providers: [MetricsService],
      exports: [LoggerModule, MetricsService],
    };
  }
}

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { ERROR_ENVELOPE_SCHEMA } from './schemas.js';

export function createQueueForgeOpenApiDocument(
  app: INestApplication,
  refreshCookieName = 'queueforge_refresh',
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('QueueForge API')
    .setDescription(
      'Tenant-scoped workflow automation, approvals, durable queues, API clients, and signed webhooks.',
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Short-lived access token returned by the login or refresh operation.',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'Authorization',
        description: 'Use: ApiKey <tenantId>.<keyId>.<secret>',
      },
      'apiKey',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        description: 'Production-only Prometheus endpoint token configured by METRICS_TOKEN.',
      },
      'metricsBearer',
    )
    .addCookieAuth(
      refreshCookieName,
      {
        type: 'apiKey',
        in: 'cookie',
        description: 'Rotating HttpOnly refresh cookie set by login and refresh.',
      },
      'refreshCookie',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config);
  document.components = {
    ...document.components,
    schemas: {
      ...document.components?.schemas,
      ErrorEnvelope: ERROR_ENVELOPE_SCHEMA,
    },
  };
  return document;
}

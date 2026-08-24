import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { StructuredLogger } from '@queueforge/observability';
import { INBOUND_WEBHOOK_HEADERS } from '@queueforge/contracts';

import { ApiModule, runtimeEnvironment } from './api.module.js';
import { configureBodyParsers } from './common/body-parsers.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';
import { createQueueForgeOpenApiDocument } from './openapi/document.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
    bodyParser: false,
    bufferLogs: true,
    rawBody: true,
  });
  app.useLogger(app.get(StructuredLogger));
  app.enableShutdownHooks();
  const requestContext = app.get(RequestContextMiddleware);
  app.use(requestContext.use.bind(requestContext));
  if (runtimeEnvironment.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }
  app.use(
    helmet({
      contentSecurityPolicy: runtimeEnvironment.NODE_ENV === 'production' ? undefined : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  configureBodyParsers(app);
  app.enableCors({
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: runtimeEnvironment.WEB_ORIGIN,
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Correlation-Id',
      'X-CSRF-Token',
      INBOUND_WEBHOOK_HEADERS.eventId,
      INBOUND_WEBHOOK_HEADERS.keyId,
      INBOUND_WEBHOOK_HEADERS.nonce,
      INBOUND_WEBHOOK_HEADERS.signature,
      INBOUND_WEBHOOK_HEADERS.timestamp,
    ],
    exposedHeaders: ['Idempotency-Replayed', 'X-Correlation-Id', 'X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      whitelist: true,
    }),
  );

  if (runtimeEnvironment.NODE_ENV !== 'production') {
    const document = createQueueForgeOpenApiDocument(app, runtimeEnvironment.REFRESH_COOKIE_NAME);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: false },
    });
  }

  await app.listen(runtimeEnvironment.API_PORT, runtimeEnvironment.API_HOST);
}

void bootstrap();

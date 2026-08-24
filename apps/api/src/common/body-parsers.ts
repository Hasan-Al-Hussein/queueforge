import { raw } from 'express';
import type { RequestHandler } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { QueueForgeRequest } from './http-context.js';

export const INBOUND_WEBHOOK_ROUTE_PREFIX = '/api/v1/inbound/webhooks';

export const inboundWebhookRawBodyParser: RequestHandler = raw({
  limit: '1mb',
  type: ['application/json', 'application/*+json'],
  verify(request, _response, buffer) {
    (request as unknown as QueueForgeRequest).rawBody = Buffer.from(buffer);
  },
});

export function configureBodyParsers(app: NestExpressApplication): void {
  // This parser must be registered before the global JSON parser. It consumes the
  // inbound webhook stream without decoding JSON so HMAC authentication can run first.
  app.use(INBOUND_WEBHOOK_ROUTE_PREFIX, inboundWebhookRawBodyParser);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });
}

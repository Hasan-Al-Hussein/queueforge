import express from 'express';
import type { ErrorRequestHandler, Request, Response } from 'express';
import request from 'supertest';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import type { QueueForgeRequest } from './http-context.js';
import { INBOUND_WEBHOOK_ROUTE_PREFIX, inboundWebhookRawBodyParser } from './body-parsers.js';

describe('inbound webhook body parsing boundary', () => {
  it('preserves malformed JSON as raw bytes before the global JSON parser can reject it', async () => {
    const app = express();
    app.use(INBOUND_WEBHOOK_ROUTE_PREFIX, inboundWebhookRawBodyParser);
    app.use(express.json({ limit: '1mb' }));
    app.post(
      `${INBOUND_WEBHOOK_ROUTE_PREFIX}/:tenantSlug/:endpointId`,
      (incoming: Request, response: Response) => {
        const queueForgeRequest = incoming as QueueForgeRequest;
        response.status(202).json({
          bodyIsBuffer: Buffer.isBuffer(incoming.body),
          rawBody: queueForgeRequest.rawBody?.toString('utf8'),
        });
      },
    );

    const malformed = '{"workflowKey":';
    const response = await request(app)
      .post(`${INBOUND_WEBHOOK_ROUTE_PREFIX}/acme-demo/50000000-0000-4000-8000-000000000001`)
      .set('content-type', 'application/json')
      .send(malformed)
      .expect(202);

    expect(response.body).toEqual({ bodyIsBuffer: true, rawBody: malformed });
  });

  it('continues to decode ordinary JSON routes', async () => {
    const app = express();
    app.use(INBOUND_WEBHOOK_ROUTE_PREFIX, inboundWebhookRawBodyParser);
    app.use(express.json({ limit: '1mb' }));
    app.post('/api/v1/probe', (incoming: Request, response: Response) => {
      response.json(incoming.body);
    });

    await request(app).post('/api/v1/probe').send({ healthy: true }).expect(200, { healthy: true });
  });

  it.each([
    ['malformed JSON', '{"broken":', 400, 'VALIDATION_FAILED'],
    [
      'an oversized body',
      JSON.stringify({ body: 'x'.repeat(1_048_577) }),
      413,
      'PAYLOAD_TOO_LARGE',
    ],
  ] as const)(
    'maps %s from the real parser into the stable envelope',
    async (_name, body, status, code) => {
      const app = express();
      app.use((incoming, _response, next) => {
        const queueForgeRequest = incoming as QueueForgeRequest;
        queueForgeRequest.requestId = '10000000-0000-4000-8000-000000000001';
        queueForgeRequest.correlationId = '20000000-0000-4000-8000-000000000001';
        next();
      });
      app.use(express.json({ limit: '1mb' }));
      app.post('/api/v1/probe', (_incoming, response) => response.status(204).end());
      const filter = new AllExceptionsFilter();
      const errorBoundary: ErrorRequestHandler = (error, incoming, response, next) => {
        void next;
        filter.catch(error, {
          getType: () => 'http',
          switchToHttp: () => ({
            getRequest: () => incoming,
            getResponse: () => response,
          }),
        } as never);
      };
      app.use(errorBoundary);

      const response = await request(app)
        .post('/api/v1/probe')
        .set('content-type', 'application/json')
        .send(body)
        .expect(status);

      expect(response.body).toMatchObject({ error: { code } });
    },
  );
});

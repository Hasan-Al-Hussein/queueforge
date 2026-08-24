import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { deliverWebhookHttp } from './webhook-http-client.js';

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

describe('pinned outbound webhook HTTP delivery', () => {
  it('never follows redirects and classifies them as terminal', async () => {
    let redirectedRequests = 0;
    const destination = createServer((_request, response) => {
      redirectedRequests += 1;
      response.writeHead(204).end();
    });
    const destinationPort = await listen(destination);
    const redirector = createServer((_request, response) => {
      response.writeHead(302, {
        location: `http://127.0.0.1:${destinationPort}/captured`,
      });
      response.end();
    });
    const redirectorPort = await listen(redirector);

    try {
      const result = await deliverWebhookHttp({
        attempt: 1,
        correlationId: randomUUID(),
        eventId: randomUUID(),
        keyId: 'local-v1',
        policy: {
          allowPrivateNetworks: true,
          allowedHosts: new Set(['local-sink.test']),
        },
        rawBody: Buffer.from('{}'),
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        secret: 'worker-test-secret-that-is-at-least-32-characters',
        targetUrl: `http://local-sink.test:${redirectorPort}/webhooks`,
        timeoutMs: 2_000,
      });

      expect(result).toMatchObject({
        errorCode: 'WEBHOOK_REDIRECT_BLOCKED',
        outcome: 'terminal_failure',
        statusCode: 302,
      });
      expect(redirectedRequests).toBe(0);
    } finally {
      await Promise.all([close(redirector), close(destination)]);
    }
  });
});

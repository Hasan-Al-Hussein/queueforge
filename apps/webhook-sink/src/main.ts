import { loadSinkEnvironment } from '@queueforge/config';

import { createWebhookSinkServer } from './sink-server.js';

async function bootstrap(): Promise<void> {
  const environment = loadSinkEnvironment();
  const controlToken = process.env.SINK_CONTROL_TOKEN;
  if (controlToken !== undefined && controlToken.length < 32) {
    throw new Error('SINK_CONTROL_TOKEN must contain at least 32 characters');
  }
  const sink = createWebhookSinkServer({
    clockSkewSeconds: environment.SINK_CLOCK_SKEW_SECONDS,
    controlToken,
    host: environment.SINK_HOST,
    keyId: environment.SINK_KEY_ID,
    port: environment.SINK_PORT,
    production: environment.NODE_ENV === 'production',
    secret: environment.SINK_SECRET,
  });

  const port = await sink.listen();
  process.stdout.write(
    `${JSON.stringify({ event: 'sink.started', host: environment.SINK_HOST, port })}\n`,
  );

  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    process.stdout.write(`${JSON.stringify({ event: 'sink.stopping', signal })}\n`);
    await sink.close();
  };
  process.once('SIGINT', () => void close('SIGINT'));
  process.once('SIGTERM', () => void close('SIGTERM'));
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`${JSON.stringify({ event: 'sink.start_failed', message })}\n`);
  process.exitCode = 1;
});

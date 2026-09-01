export const SHOWCASE_MODE = process.env.NEXT_PUBLIC_QUEUEFORGE_MODE === 'showcase';

export const SHOWCASE_DISCLOSURE =
  'Public portfolio demo with synthetic data. No uploads, persistence, live AI, or real-world actions.';

export function assertLocalTransportAllowed(): void {
  if (!SHOWCASE_MODE) return;
  throw new Error('Network transport is disabled in the QueueForge public showcase.');
}

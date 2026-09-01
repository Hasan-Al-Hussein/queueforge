import type { QueueSnapshot } from '../../domain/models';

export const MOBILE_RECOVERY_PREVIEW_SIZE = 5;

const QUEUE_LABELS: Readonly<Record<string, string>> = {
  'queueforge.notifications': 'Notifications',
  'queueforge.other': 'Other background work',
  'queueforge.requests': 'Requests',
  'queueforge.webhooks': 'Result deliveries',
};

const FAILURE_EXPLANATIONS: readonly [RegExp, string][] = [
  [
    /worker attempt interrupted; attempts exhausted/iu,
    'Processing stopped before it could finish, and all automatic retries were used.',
  ],
  [
    /delivery worker lease expired; attempts exhausted/iu,
    'Result delivery stopped unexpectedly, and all automatic retries were used.',
  ],
  [
    /webhook attempts exhausted/iu,
    'The receiving system did not accept the result after every retry.',
  ],
  [/timed? out/iu, 'The operation took too long to respond.'],
  [/connection refused/iu, 'The receiving system could not be reached.'],
];

function sentenceFromCode(value: string): string {
  const words = value
    .replace(/^queueforge\./u, '')
    .replaceAll(/[._-]+/gu, ' ')
    .trim();
  if (words === '') return 'Background work';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export function queueDisplayName(name: string): string {
  return QUEUE_LABELS[name] ?? sentenceFromCode(name);
}

export function requestTypeDisplayName(name: string): string {
  if (/^exhausted workflow\b/iu.test(name)) return 'Demo processing-failure check';
  if (/^recovery workflow\b/iu.test(name)) return 'Demo recovery check';
  return name;
}

export function failureExplanation(reason: string): string {
  return (
    FAILURE_EXPLANATIONS.find(([pattern]) => pattern.test(reason))?.[1] ??
    'QueueForge could not finish this request. Open the request before trying again.'
  );
}

export function automaticTryLabel(attemptCount: number): string {
  return `${String(attemptCount)} automatic ${attemptCount === 1 ? 'try' : 'tries'}`;
}

export function recoveryPreviewToggleLabel(loadedCount: number, expanded: boolean): string {
  return expanded
    ? 'Show fewer requests'
    : `Show ${String(Math.max(loadedCount - MOBILE_RECOVERY_PREVIEW_SIZE, 0))} more on this page`;
}

export interface QueueStatePresentation {
  readonly label: string;
  readonly status: string;
  readonly workerLabel: string;
}

export function queueStatePresentation(
  queue: Pick<
    QueueSnapshot,
    | 'active'
    | 'delayed'
    | 'failed'
    | 'outboxDead'
    | 'paused'
    | 'telemetryAvailable'
    | 'waiting'
    | 'workerState'
  >,
): QueueStatePresentation {
  const workerLabel =
    queue.workerState === 'offline'
      ? 'not responding'
      : queue.workerState === 'draining'
        ? 'finishing current work'
        : queue.workerState === 'unavailable'
          ? 'not visible in this workspace'
          : queue.paused
            ? 'paused'
            : 'available';

  if (!queue.telemetryAvailable) {
    return {
      label: queue.outboxDead > 0 ? 'handoff needs attention' : 'accepted safely',
      status: queue.outboxDead > 0 ? 'failed' : 'queued',
      workerLabel,
    };
  }
  if (queue.workerState === 'offline') {
    return { label: 'processor offline', status: 'failed', workerLabel };
  }
  if (queue.workerState === 'draining') {
    return { label: 'finishing work', status: 'retry', workerLabel };
  }
  if (queue.paused) return { label: 'paused', status: 'retired', workerLabel };
  if (queue.failed > 0) return { label: 'needs attention', status: 'failed', workerLabel };
  if (queue.active > 0) return { label: 'working', status: 'processing', workerLabel };
  if (queue.waiting + queue.delayed > 0) {
    return { label: 'work queued', status: 'queued', workerLabel };
  }
  return { label: 'clear', status: 'healthy', workerLabel };
}

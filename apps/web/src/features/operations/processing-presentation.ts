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

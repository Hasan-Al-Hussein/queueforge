import type {
  RequestSource,
  WorkflowRequestStatus,
  WorkflowRequestView,
  WorkflowSummary,
} from '@queueforge/contracts';

const REQUEST_STATUS_LABELS: Readonly<Record<WorkflowRequestStatus, string>> = {
  approved: 'Approved',
  cancelled: 'Cancelled',
  dead_lettered: 'Needs help',
  failed: 'Trying again',
  pending_approval: 'Waiting for approval',
  processing: 'In progress',
  queued: 'Ready to start',
  received: 'Received',
  rejected: 'Declined',
  succeeded: 'Completed',
  validation_failed: 'Information needed',
};

const REQUEST_SOURCE_LABELS: Readonly<Record<RequestSource, string>> = {
  graphql: 'Connected app',
  inbound_webhook: 'External integration',
  rest: 'QueueForge form',
  system: 'QueueForge automation',
};

const SYSTEM_CHECK_NAME = /^(?:recovery|exhausted) workflow\b/i;
const SYSTEM_CHECK_KEY = /^(?:recovery|exhausted)_[a-z0-9_-]+$/i;

export function requestStatusLabel(status: WorkflowRequestStatus): string {
  return REQUEST_STATUS_LABELS[status];
}

export function requestSourceLabel(source: RequestSource): string {
  return REQUEST_SOURCE_LABELS[source];
}

const TRANSITION_REASON_LABELS: Readonly<Record<string, string>> = {
  approval_required: 'Sent for approval',
  approval_recorded: 'Decision recorded',
  cancelled_by_operator: 'Cancelled by an operator',
  manual_retry: 'An operator started another try',
  processing_started: 'QueueForge started the work',
  request_approved: 'Request approved',
  request_rejected: 'Request declined',
  request_submitted: 'Request submitted',
  retry_scheduled: 'QueueForge scheduled another try',
  succeeded: 'Work completed successfully',
  validation_failed: 'Some submitted information needs correction',
  worker_interrupted: 'Processing was interrupted safely',
};

export function requestTransitionReasonLabel(reason: string | null): string | undefined {
  if (reason === null || reason.trim() === '') return undefined;
  const known = TRANSITION_REASON_LABELS[reason];
  if (known !== undefined) return known;
  const spaced = reason.replaceAll(/[._-]+/g, ' ').trim();
  return spaced === '' ? undefined : `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

export function requestProgressLabel(request: WorkflowRequestView): string {
  if (request.status === 'pending_approval') return 'Waiting for a decision';
  if (request.status === 'queued' || request.status === 'approved') return 'Not started yet';
  if (request.status === 'cancelled' || request.status === 'rejected') return 'Stopped';
  if (request.status === 'succeeded') {
    if (request.attemptCount <= 1) return 'Finished on the first try';
    return `Finished after ${String(request.attemptCount)} tries`;
  }
  if (request.status === 'dead_lettered') {
    return `Stopped after ${String(request.attemptCount)} of ${String(request.maxAttempts)} tries`;
  }
  if (request.status === 'processing') {
    return `Try ${String(Math.max(request.attemptCount, 1))} of ${String(request.maxAttempts)}`;
  }
  if (request.status === 'failed') {
    return `Retrying · ${String(request.attemptCount)} of ${String(request.maxAttempts)} tries used`;
  }
  return request.attemptCount === 0
    ? 'Not started yet'
    : `${String(request.attemptCount)} of ${String(request.maxAttempts)} tries used`;
}

export function isSystemCheckWorkflow(workflow: WorkflowSummary): boolean {
  return SYSTEM_CHECK_NAME.test(workflow.name) || SYSTEM_CHECK_KEY.test(workflow.stableKey);
}

export function requestTypeLabel(name: string): string {
  if (/^recovery workflow\b/i.test(name)) return 'Demo recovery check';
  if (/^exhausted workflow\b/i.test(name)) return 'Demo processing-failure check';
  return name;
}

function sentenceCaseKey(key: string): string {
  const spaced = key
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return spaced === '' ? 'Detail' : `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

function formatPreviewValue(value: unknown): string {
  if (typeof value === 'string') return value.trim() === '' ? 'Not provided' : value;
  if (typeof value === 'number') return new Intl.NumberFormat().format(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value === null || value === undefined) return 'Not provided';
  if (Array.isArray(value)) return `${String(value.length)} selected`;
  return 'Additional details';
}

export function approvalPayloadPreview(payloadSummary: string): string {
  try {
    const parsed = JSON.parse(payloadSummary) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return 'Open to review the request details';
    }
    const entries = Object.entries(parsed).slice(0, 3);
    if (entries.length === 0) return 'No extra information was provided';
    return entries
      .map(([key, value]) => `${sentenceCaseKey(key)}: ${formatPreviewValue(value)}`)
      .join(' · ');
  } catch {
    return 'Open to review the request details';
  }
}

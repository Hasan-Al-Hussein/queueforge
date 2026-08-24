import type { WorkflowRequestStatus } from '@queueforge/contracts';

import { DomainError } from './errors.js';

const TRANSITIONS = {
  received: ['validation_failed', 'pending_approval', 'queued'],
  validation_failed: [],
  pending_approval: ['approved', 'rejected', 'cancelled'],
  approved: ['queued'],
  rejected: [],
  queued: ['processing', 'cancelled'],
  processing: ['succeeded', 'failed'],
  succeeded: [],
  failed: ['queued', 'dead_lettered'],
  dead_lettered: ['queued'],
  cancelled: [],
} as const satisfies Record<WorkflowRequestStatus, readonly WorkflowRequestStatus[]>;

const MANUAL_RETRY_SOURCES = new Set<WorkflowRequestStatus>(['failed', 'dead_lettered']);

export interface TransitionPolicy {
  readonly manualRetry?: boolean;
}

export function allowedRequestTransitions(
  current: WorkflowRequestStatus,
): readonly WorkflowRequestStatus[] {
  return TRANSITIONS[current];
}

export function canTransitionRequest(
  current: WorkflowRequestStatus,
  next: WorkflowRequestStatus,
  policy: TransitionPolicy = {},
): boolean {
  if (!TRANSITIONS[current].includes(next as never)) {
    return false;
  }
  if (current === 'dead_lettered' && next === 'queued') {
    return policy.manualRetry === true;
  }
  if (policy.manualRetry === true) {
    return MANUAL_RETRY_SOURCES.has(current) && next === 'queued';
  }
  return true;
}

export function assertRequestTransition(
  current: WorkflowRequestStatus,
  next: WorkflowRequestStatus,
  policy: TransitionPolicy = {},
): void {
  if (!canTransitionRequest(current, next, policy)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `Workflow request cannot transition from ${current} to ${next}`,
      { current, next },
    );
  }
}

export const terminalRequestStatuses = Object.freeze(
  (Object.keys(TRANSITIONS) as WorkflowRequestStatus[]).filter(
    (status) => TRANSITIONS[status].length === 0,
  ),
);

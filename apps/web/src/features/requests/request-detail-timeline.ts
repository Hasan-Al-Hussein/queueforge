import type { WorkflowRequestStatus } from '@queueforge/contracts';
import type { QueueRailItem, RailState } from '@queueforge/ui';

import type { RequestDetail } from '../../domain/models';
import { requestStatusLabel, requestTransitionReasonLabel } from '../../domain/presentation';

const FAILED_STATUSES: ReadonlySet<WorkflowRequestStatus> = new Set([
  'dead_lettered',
  'failed',
  'rejected',
  'validation_failed',
]);

function timelineState(status: WorkflowRequestStatus, isLast: boolean): RailState {
  if (FAILED_STATUSES.has(status)) return 'failed';
  if (!isLast || status === 'succeeded' || status === 'cancelled') return 'complete';
  return 'current';
}

export function requestTimelineItems(detail: RequestDetail): readonly QueueRailItem[] {
  if (detail.transitions.length === 0) {
    return [
      {
        id: detail.request.id,
        label: requestStatusLabel(detail.request.status),
        state: timelineState(detail.request.status, true),
        timestamp: detail.request.statusChangedAt,
      },
    ];
  }

  return detail.transitions.map((transition, index) => {
    const description = [
      transition.actorName,
      requestTransitionReasonLabel(transition.reason ?? null),
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(' · ');

    return {
      id: transition.id,
      label: requestStatusLabel(transition.toStatus),
      description: description === '' ? undefined : description,
      state: timelineState(transition.toStatus, index === detail.transitions.length - 1),
      timestamp: new Date(transition.occurredAt).toLocaleString(),
    };
  });
}

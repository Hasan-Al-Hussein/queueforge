import { describe, expect, it } from 'vitest';

import type { RequestDetail } from '../../domain/models';
import { requestTimelineItems } from './request-detail-timeline';

const REQUEST_ID = '10000000-0000-4000-8000-000000000001';
const NOW = '2026-08-25T02:40:24.000Z';

function detailWithStatus(status: RequestDetail['request']['status']): RequestDetail {
  return {
    request: {
      id: REQUEST_ID,
      workflowId: '10000000-0000-4000-8000-000000000002',
      workflowVersionId: '10000000-0000-4000-8000-000000000003',
      workflowName: 'Expense review',
      versionNo: 1,
      status,
      source: 'rest',
      payload: {},
      correlationId: '10000000-0000-4000-8000-000000000004',
      submittedAt: NOW,
      statusChangedAt: NOW,
      attemptCount: 1,
      maxAttempts: 5,
    },
    transitions: [],
    approval: null,
  };
}

describe('requestTimelineItems', () => {
  it('presents a completed request as complete instead of current', () => {
    const detail = detailWithStatus('succeeded');
    detail.transitions.push(
      {
        id: '10000000-0000-4000-8000-000000000005',
        fromStatus: null,
        toStatus: 'received',
        reason: 'request_submitted',
        actorName: 'Omar Operator',
        occurredAt: NOW,
      },
      {
        id: '10000000-0000-4000-8000-000000000006',
        fromStatus: 'processing',
        toStatus: 'succeeded',
        reason: 'succeeded',
        actorName: 'Worker',
        occurredAt: NOW,
      },
    );

    expect(requestTimelineItems(detail)).toMatchObject([
      { label: 'Received', state: 'complete' },
      { label: 'Completed', state: 'complete' },
    ]);
  });

  it('keeps active states current and labels them in sentence case', () => {
    expect(requestTimelineItems(detailWithStatus('pending_approval'))).toMatchObject([
      { label: 'Waiting for approval', state: 'current' },
    ]);
    expect(requestTimelineItems(detailWithStatus('processing'))).toMatchObject([
      { label: 'In progress', state: 'current' },
    ]);
  });

  it('marks terminal success complete even when no transitions were returned', () => {
    expect(requestTimelineItems(detailWithStatus('succeeded'))).toMatchObject([
      { label: 'Completed', state: 'complete' },
    ]);
  });
});

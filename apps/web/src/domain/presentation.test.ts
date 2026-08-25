import { describe, expect, it } from 'vitest';

import type { WorkflowRequestView, WorkflowSummary } from '@queueforge/contracts';

import {
  approvalPayloadPreview,
  isSystemCheckWorkflow,
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTransitionReasonLabel,
  requestTypeLabel,
} from './presentation';

const request: WorkflowRequestView = {
  attemptCount: 1,
  correlationId: '20000000-0000-4000-8000-000000000001',
  id: '20000000-0000-4000-8000-000000000002',
  maxAttempts: 5,
  payload: {},
  source: 'rest',
  status: 'succeeded',
  statusChangedAt: '2026-08-25T04:00:00.000Z',
  submittedAt: '2026-08-25T03:59:00.000Z',
  versionNo: 1,
  workflowId: '20000000-0000-4000-8000-000000000003',
  workflowName: 'Expense review',
  workflowVersionId: '20000000-0000-4000-8000-000000000004',
};

const workflow: WorkflowSummary = {
  description: null,
  id: '30000000-0000-4000-8000-000000000001',
  isEnabled: true,
  name: 'Expense review',
  requiresApproval: true,
  revision: 1,
  stableKey: 'expense_review',
  updatedAt: '2026-08-25T04:00:00.000Z',
  versionId: '30000000-0000-4000-8000-000000000002',
  versionNo: 1,
  versionStatus: 'active',
};

describe('plain-language presentation helpers', () => {
  it('translates request state, origin, and progress without infrastructure jargon', () => {
    expect(requestStatusLabel('pending_approval')).toBe('Waiting for approval');
    expect(requestSourceLabel('inbound_webhook')).toBe('External integration');
    expect(requestProgressLabel(request)).toBe('Finished on the first try');
    expect(requestTransitionReasonLabel('retry_scheduled')).toBe(
      'QueueForge scheduled another try',
    );
  });

  it('turns a stored JSON payload summary into a short readable preview', () => {
    expect(approvalPayloadPreview('{"amount":1250,"costCenter":"OPS-42","urgent":true}')).toBe(
      'Amount: 1,250 · Cost Center: OPS-42 · Urgent: Yes',
    );
    expect(approvalPayloadPreview('{broken')).toBe('Open to review the request details');
  });

  it('separates system-check workflows without hiding ordinary business workflows', () => {
    expect(isSystemCheckWorkflow(workflow)).toBe(false);
    expect(
      isSystemCheckWorkflow({
        ...workflow,
        name: 'Recovery workflow mt7gqyk0',
        stableKey: 'recovery_mt7gqyk0',
      }),
    ).toBe(true);
  });

  it('replaces generated system-check names with stable demo labels', () => {
    expect(requestTypeLabel('Recovery workflow mt7gqyk0')).toBe('Demo recovery check');
    expect(requestTypeLabel('Exhausted workflow mt7z31q')).toBe('Demo processing-failure check');
    expect(requestTypeLabel('Expense review')).toBe('Expense review');
  });
});

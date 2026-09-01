import { describe, expect, it } from 'vitest';

import type { ApprovalTask } from '../../domain/models';
import {
  approvalDecisionDetailsReady,
  approvalMatchesSearch,
  approvalPayloadDigest,
  prioritizeApprovalsForFocus,
} from './approvals-screen';

const TASK: ApprovalTask = {
  id: '10000000-0000-4000-8000-000000000001',
  requestId: '10000000-0000-4000-8000-000000000002',
  workflowName: 'Expense review',
  requestedById: '10000000-0000-4000-8000-000000000003',
  requestedByName: 'Omar Operator',
  payloadSummary: '{"costCenter":"OPS-42"}',
  status: 'pending',
  revision: 1,
  createdAt: '2026-08-25T02:40:24.000Z',
};

describe('approval decision detail policy', () => {
  it('allows a decision only after the full request details load successfully', () => {
    expect(approvalDecisionDetailsReady({ error: null, hasDetails: true, isLoading: false })).toBe(
      true,
    );
    expect(approvalDecisionDetailsReady({ error: null, hasDetails: false, isLoading: true })).toBe(
      false,
    );
    expect(
      approvalDecisionDetailsReady({
        error: new Error('Failed'),
        hasDetails: false,
        isLoading: false,
      }),
    ).toBe(false);
    expect(
      approvalDecisionDetailsReady({
        error: new Error('Stale detail failed to refresh'),
        hasDetails: true,
        isLoading: false,
      }),
    ).toBe(false);
  });

  it('matches the compact decision queue by human or submitted detail', () => {
    expect(approvalMatchesSearch(TASK, 'expense')).toBe(true);
    expect(approvalMatchesSearch(TASK, 'OMAR')).toBe(true);
    expect(approvalMatchesSearch(TASK, 'ops-42')).toBe(true);
    expect(approvalMatchesSearch(TASK, 'approved')).toBe(false);
    expect(approvalMatchesSearch(TASK, '   ')).toBe(true);
  });

  it('keeps each submitted fact visible without letting one long value dominate the queue', () => {
    expect(
      approvalPayloadDigest(
        JSON.stringify({
          amount: 25,
          summary: 'k6 webhook-inbound_webhooks-2-5-a80c806a-bb62-420d-a113-2223bb500b50',
          costCenter: 'QA',
        }),
      ),
    ).toBe('Amount: 25 · Summary: k6 webhook-inbound_webhooks-2-5-a8… · Cost Center: QA');
  });

  it('keeps short summaries unchanged and falls back safely for non-object payloads', () => {
    expect(approvalPayloadDigest('{"amount":25,"costCenter":"QA"}')).toBe(
      'Amount: 25 · Cost Center: QA',
    );
    expect(approvalPayloadDigest('{broken')).toBe('Open to review the request details');
  });

  it('continues to search the complete payload even when its visual digest is shortened', () => {
    const longSummaryTask = {
      ...TASK,
      payloadSummary:
        '{"summary":"k6 webhook-inbound_webhooks-2-5-a80c806a-bb62-420d-a113-2223bb500b50"}',
    } satisfies ApprovalTask;

    expect(approvalPayloadDigest(longSummaryTask.payloadSummary)).not.toContain('2223bb500b50');
    expect(approvalMatchesSearch(longSummaryTask, '2223bb500b50')).toBe(true);
  });

  it('surfaces actionable work first without inventing a business priority', () => {
    const decided = {
      ...TASK,
      id: '20000000-0000-4000-8000-000000000001',
      status: 'approved',
    } as const satisfies ApprovalTask;
    const selfRequested = {
      ...TASK,
      id: '30000000-0000-4000-8000-000000000001',
      requestedById: 'current-user',
    } satisfies ApprovalTask;
    const actionable = {
      ...TASK,
      id: '40000000-0000-4000-8000-000000000001',
    } satisfies ApprovalTask;

    expect(
      prioritizeApprovalsForFocus({
        canApprove: true,
        currentUserId: 'current-user',
        rows: [decided, selfRequested, actionable],
      }).map((task) => task.id),
    ).toEqual([actionable.id, decided.id, selfRequested.id]);
    expect(
      prioritizeApprovalsForFocus({
        canApprove: false,
        currentUserId: 'current-user',
        rows: [decided, selfRequested, actionable],
      }).map((task) => task.id),
    ).toEqual([decided.id, selfRequested.id, actionable.id]);
  });
});

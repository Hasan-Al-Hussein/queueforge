import { describe, expect, it } from 'vitest';

import { approvalDecisionDetailsReady } from './approvals-screen';

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
});

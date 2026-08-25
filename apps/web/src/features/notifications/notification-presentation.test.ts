import { describe, expect, it } from 'vitest';

import { notificationPresentation } from './notification-presentation';

describe('notification presentation', () => {
  it('shows an approval result as positive instead of warning', () => {
    expect(
      notificationPresentation({
        body: 'Request approved',
        kind: 'warning',
        title: 'Approval decision recorded',
      }),
    ).toEqual({ heading: 'Request approved', label: 'Approved', status: 'succeeded' });
  });

  it('separates rejection and decision-needed states', () => {
    expect(
      notificationPresentation({
        body: 'Request rejected',
        kind: 'warning',
        title: 'Approval decision recorded',
      }).label,
    ).toBe('Rejected');
    expect(
      notificationPresentation({
        body: 'Review Expense report',
        kind: 'warning',
        title: 'Approval required',
      }).label,
    ).toBe('Action needed');
  });

  it('does not mistake an unrelated review message for an approval', () => {
    expect(
      notificationPresentation({
        body: 'Review the exported report',
        kind: 'success',
        title: 'Report ready',
      }),
    ).toEqual({ heading: 'Report ready', label: 'Delivered', status: 'succeeded' });
  });
});

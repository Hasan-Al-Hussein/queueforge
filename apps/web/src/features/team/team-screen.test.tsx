import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MOBILE_MEMBER_PREVIEW_SIZE, MobileMemberDisclosure, TEAM_PAGE_SIZE } from './team-screen';

describe('team mobile disclosure', () => {
  it('uses the compact initial page and preview sizes', () => {
    expect(TEAM_PAGE_SIZE).toBe(10);
    expect(MOBILE_MEMBER_PREVIEW_SIZE).toBe(5);
  });

  it('announces the collapsed scope and exposes an accessible expansion control', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<MobileMemberDisclosure expanded={false} onToggle={onToggle} totalMembers={10} />);

    expect(screen.getByText(/Showing up to 5 people/)).toHaveTextContent(
      'Search checks all 10 people on this page.',
    );
    const button = screen.getByRole('button', { name: 'Show everyone on this page' });
    expect(button).toHaveAttribute('aria-controls', 'team-membership-results');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('offers a clear way back to the compact view', () => {
    render(<MobileMemberDisclosure expanded onToggle={() => undefined} totalMembers={8} />);

    expect(screen.getByText('Showing everyone on this page (8 people).')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show fewer people' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

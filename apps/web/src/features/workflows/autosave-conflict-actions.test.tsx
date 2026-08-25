import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AutosaveConflictActions } from './autosave-conflict-actions';

describe('AutosaveConflictActions', () => {
  it('requires an explicit server-or-local recovery choice', async () => {
    const user = userEvent.setup();
    const loadServer = vi.fn();
    const keepLocal = vi.fn();
    render(<AutosaveConflictActions onKeepLocal={keepLocal} onLoadServer={loadServer} />);
    await user.click(screen.getByRole('button', { name: 'Use saved copy' }));
    await user.click(screen.getByRole('button', { name: 'Keep my changes' }));
    expect(loadServer).toHaveBeenCalledOnce();
    expect(keepLocal).toHaveBeenCalledOnce();
  });
});

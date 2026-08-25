import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiProblem } from '../api/client';
import { InlineLoadError } from './inline-load-error';

describe('InlineLoadError', () => {
  it('explains the failed content and offers a working retry action', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <InlineLoadError
        error={new ApiProblem({ code: 'NETWORK_ERROR', message: 'Connection refused', status: 0 })}
        onRetry={onRetry}
        title="Could not load request details"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load request details');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('prevents duplicate retries while a retry is running', () => {
    render(
      <InlineLoadError
        error={new Error('Unavailable')}
        onRetry={vi.fn()}
        retrying
        title="Failed"
      />,
    );

    expect(screen.getByRole('button', { name: 'Trying again' })).toBeDisabled();
  });
});

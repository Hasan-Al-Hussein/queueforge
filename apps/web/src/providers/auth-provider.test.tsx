import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ApiClientModule from '../api/client';
import { ApiProblem, getCsrfToken, recoverAuthenticationSession } from '../api/client';
import { AuthProvider, useAuth } from './auth-provider';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    configureAuthRecovery: vi.fn(() => () => undefined),
    getCsrfToken: vi.fn(),
    recoverAuthenticationSession: vi.fn(),
    setAccessToken: vi.fn(),
  };
});

function AuthStatusProbe(): React.JSX.Element {
  const { bootstrapError, status } = useAuth();
  return <output>{`${status}:${bootstrapError ?? 'no error'}`}</output>;
}

describe('AuthProvider bootstrap', () => {
  beforeEach(() => {
    vi.mocked(getCsrfToken).mockReset();
    vi.mocked(recoverAuthenticationSession).mockReset();
  });

  it('treats a first visit without the CSRF session cookie as anonymous without refreshing', async () => {
    vi.mocked(getCsrfToken).mockReturnValue(null);

    render(
      <AuthProvider>
        <AuthStatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('anonymous:no error')).toBeVisible());
    expect(recoverAuthenticationSession).not.toHaveBeenCalled();
  });

  it('still attempts session recovery when the CSRF session cookie is present', async () => {
    vi.mocked(getCsrfToken).mockReturnValue('csrf-token');
    vi.mocked(recoverAuthenticationSession).mockRejectedValue(
      new ApiProblem({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'The refresh session has expired.',
        status: 401,
      }),
    );

    render(
      <AuthProvider>
        <AuthStatusProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(recoverAuthenticationSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('anonymous:no error')).toBeVisible());
  });
});

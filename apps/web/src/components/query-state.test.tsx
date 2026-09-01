import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiProblem } from '../api/client';
import { QueryState } from './query-state';

describe('QueryState', () => {
  it('explains an offline recovery path', () => {
    render(
      <QueryState
        error={new ApiProblem({ code: 'NETWORK_ERROR', message: 'Connection refused', status: 0 })}
        isLoading={false}
      >
        <p>Loaded</p>
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: 'API unavailable' })).toBeInTheDocument();
    expect(screen.getByText(/port 3001/i)).toBeInTheDocument();
  });

  it('does not mask a forbidden response', () => {
    render(
      <QueryState
        error={new ApiProblem({ code: 'AUTHORIZATION_DENIED', message: 'Denied', status: 403 })}
        isLoading={false}
        onRetry={vi.fn()}
      >
        <p>Loaded</p>
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch workspace' })).toHaveAttribute('href', '/');
  });

  it('recognizes a GraphQL forbidden error', () => {
    render(
      <QueryState
        error={{ errors: [{ extensions: { code: 'AUTHORIZATION_DENIED' } }] }}
        isLoading={false}
      >
        <p>Protected data</p>
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
    expect(screen.queryByText('Protected data')).not.toBeInTheDocument();
  });

  it('treats tenant-scoped not-found responses as a workspace boundary', () => {
    render(
      <QueryState
        error={new ApiProblem({ code: 'NOT_FOUND', message: 'Record not found', status: 404 })}
        isLoading={false}
        onRetry={vi.fn()}
      >
        <p>Protected record</p>
      </QueryState>,
    );
    expect(
      screen.getByRole('heading', { name: 'Record unavailable in this workspace' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Switch workspace' })).toHaveAttribute('href', '/');
  });

  it('recognizes a serialized not-found problem', () => {
    render(
      <QueryState error={{ code: 'NOT_FOUND', status: 404 }} isLoading={false}>
        <p>Protected record</p>
      </QueryState>,
    );
    expect(
      screen.getByRole('heading', { name: 'Record unavailable in this workspace' }),
    ).toBeInTheDocument();
  });

  it('recognizes a transport-preserved not-found message', () => {
    render(
      <QueryState error={new Error('workflow request was not found')} isLoading={false}>
        <p>Protected record</p>
      </QueryState>,
    );
    expect(
      screen.getByRole('heading', { name: 'Record unavailable in this workspace' }),
    ).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
      >
        <p>Loaded</p>
      </QueryState>,
    );
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeInTheDocument();
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
});

'use client';

import type { ReactNode } from 'react';

import { Button, StatePanel } from '@queueforge/ui';

import { formatProblem, isForbiddenProblem, isOfflineProblem } from '../api/client';

export function QueryState({
  children,
  empty = false,
  emptyAction,
  emptyDescription = 'Nothing matches this view yet.',
  emptyTitle = 'No results',
  error,
  isLoading,
  onRetry,
}: {
  readonly children: ReactNode;
  readonly empty?: boolean;
  readonly emptyAction?: ReactNode;
  readonly emptyDescription?: string;
  readonly emptyTitle?: string;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly onRetry?: () => void;
}): React.JSX.Element {
  if (isLoading) {
    return (
      <StatePanel
        description="Fetching the latest tenant-scoped data from QueueForge."
        kind="loading"
        title="Loading current state"
      />
    );
  }

  if (error !== null && error !== undefined) {
    const forbidden = isForbiddenProblem(error);
    const offline = isOfflineProblem(error);
    return (
      <StatePanel
        action={
          onRetry === undefined ? undefined : (
            <Button onClick={onRetry} tone="secondary">
              Try again
            </Button>
          )
        }
        description={
          forbidden
            ? 'The server denied this request for the selected tenant. Client controls never override server authorization.'
            : `${formatProblem(error)}${offline ? ' Check that the local API is running on port 3001.' : ''}`
        }
        kind={forbidden ? 'forbidden' : offline ? 'offline' : 'error'}
        title={
          forbidden ? 'Access denied' : offline ? 'API unavailable' : 'Could not load this view'
        }
      />
    );
  }

  if (empty) {
    return (
      <StatePanel
        action={emptyAction}
        description={emptyDescription}
        kind="empty"
        title={emptyTitle}
      />
    );
  }

  return <>{children}</>;
}

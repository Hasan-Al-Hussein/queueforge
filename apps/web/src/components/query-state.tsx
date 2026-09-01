'use client';

import type { ReactNode } from 'react';

import { Button, StatePanel } from '@queueforge/ui';

import {
  formatProblem,
  isForbiddenProblem,
  isNotFoundProblem,
  isOfflineProblem,
} from '../api/client';
import { WorkspaceRecoveryActions } from './workspace-recovery-actions';

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
        description="Loading the latest workspace data."
        kind="loading"
        title="Loading current state"
      />
    );
  }

  if (error !== null && error !== undefined) {
    const forbidden = isForbiddenProblem(error);
    const notFound = isNotFoundProblem(error);
    const offline = isOfflineProblem(error);
    const workspaceBoundary = forbidden || notFound;
    return (
      <StatePanel
        action={
          workspaceBoundary ? (
            <WorkspaceRecoveryActions />
          ) : onRetry === undefined ? undefined : (
            <Button onClick={onRetry} tone="secondary">
              Try again
            </Button>
          )
        }
        description={
          forbidden
            ? 'This page is not available in your current workspace. Use the navigation to return to an area assigned to your role.'
            : notFound
              ? 'This record is not available in the current workspace. Switch workspace or go back to a page you can access.'
              : `${formatProblem(error)}${offline ? ' Check that the local API is running on port 3001.' : ''}`
        }
        kind={workspaceBoundary ? 'forbidden' : offline ? 'offline' : 'error'}
        title={
          forbidden
            ? 'Access denied'
            : notFound
              ? 'Record unavailable in this workspace'
              : offline
                ? 'API unavailable'
                : 'Could not load this view'
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

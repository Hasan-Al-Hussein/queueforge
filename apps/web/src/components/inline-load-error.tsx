'use client';

import { Button, RefreshCw } from '@queueforge/ui';

import { formatProblem } from '../api/client';

export function InlineLoadError({
  error,
  onRetry,
  retrying = false,
  title,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
  readonly title: string;
}): React.JSX.Element {
  return (
    <div>
      <div className="qf-form-error" role="alert">
        <strong>{title}</strong>
        <p>{formatProblem(error)}</p>
      </div>
      <Button
        icon={<RefreshCw size={16} />}
        loading={retrying}
        loadingLabel="Trying again"
        onClick={onRetry}
        tone="secondary"
      >
        Try again
      </Button>
    </div>
  );
}

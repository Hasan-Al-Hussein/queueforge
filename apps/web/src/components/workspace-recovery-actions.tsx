'use client';

import Link from 'next/link';

import { Button } from '@queueforge/ui';

export function WorkspaceRecoveryActions(): React.JSX.Element {
  return (
    <div className="qf-workspace-recovery-actions">
      <Button onClick={() => window.history.back()} tone="secondary">
        Back
      </Button>
      <Link className="qf-button qf-button--primary" href="/" prefetch={false}>
        Switch workspace
      </Link>
    </div>
  );
}

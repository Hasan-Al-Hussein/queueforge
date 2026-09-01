import { StatePanel } from '@queueforge/ui';

import { WorkspaceRecoveryActions } from '../src/components/workspace-recovery-actions';

export default function NotFound(): React.JSX.Element {
  return (
    <main className="qf-not-found">
      <StatePanel
        action={<WorkspaceRecoveryActions />}
        description="This address is not part of the current QueueForge workspace. Go back, or return home to choose a workspace you can access."
        kind="error"
        title="Page not found"
      />
    </main>
  );
}

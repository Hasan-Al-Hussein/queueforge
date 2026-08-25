import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StatePanel } from '@queueforge/ui';

import { WORKSPACE_ROUTE_ROLES } from '../../../src/components/workspace-access';
import { WorkspaceRoute } from '../../../src/components/workspace-route';
import { WorkflowEditorScreen } from '../../../src/features/workflows/workflow-editor-screen';

export const metadata: Metadata = { title: 'Edit request type' };

export default function WorkflowEditorPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.workflowEditor}>
      <Suspense
        fallback={
          <main className="qf-session-gate">
            <StatePanel
              description="Reading the workflow identifier from this static route."
              kind="loading"
              title="Opening workflow"
            />
          </main>
        }
      >
        <WorkflowEditorScreen />
      </Suspense>
    </WorkspaceRoute>
  );
}

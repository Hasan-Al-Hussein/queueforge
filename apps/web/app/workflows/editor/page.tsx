import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StatePanel } from '@queueforge/ui';

import { WorkflowEditorScreen } from '../../../src/features/workflows/workflow-editor-screen';

export const metadata: Metadata = { title: 'Workflow editor' };

export default function WorkflowEditorPage(): React.JSX.Element {
  return (
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
  );
}

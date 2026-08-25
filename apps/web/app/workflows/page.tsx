import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { WorkflowsScreen } from '../../src/features/workflows/workflows-screen';

export const metadata: Metadata = { title: 'Request types' };

export default function WorkflowsPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.workflows}>
      <WorkflowsScreen />
    </WorkspaceRoute>
  );
}

import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { OperationsScreen } from '../../src/features/operations/operations-screen';

export const metadata: Metadata = { title: 'Processing health' };

export default function OperationsPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.operations}>
      <OperationsScreen />
    </WorkspaceRoute>
  );
}

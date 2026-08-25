import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { ApprovalsScreen } from '../../src/features/approvals/approvals-screen';

export const metadata: Metadata = { title: 'Approval inbox' };

export default function ApprovalsPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.approvals}>
      <ApprovalsScreen />
    </WorkspaceRoute>
  );
}

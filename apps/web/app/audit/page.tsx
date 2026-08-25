import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { AuditScreen } from '../../src/features/audit/audit-screen';

export const metadata: Metadata = { title: 'Activity log' };

export default function AuditPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.audit}>
      <AuditScreen />
    </WorkspaceRoute>
  );
}

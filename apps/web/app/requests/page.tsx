import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { RequestsScreen } from '../../src/features/requests/requests-screen';

export const metadata: Metadata = { title: 'Requests' };

export default function RequestsPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.requests}>
      <RequestsScreen />
    </WorkspaceRoute>
  );
}

import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { NotificationsScreen } from '../../src/features/notifications/notifications-screen';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.notifications}>
      <NotificationsScreen />
    </WorkspaceRoute>
  );
}

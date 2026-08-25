import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { TeamScreen } from '../../src/features/team/team-screen';

export const metadata: Metadata = { title: 'People & access' };

export default function TeamPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.team}>
      <TeamScreen />
    </WorkspaceRoute>
  );
}

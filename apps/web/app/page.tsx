import { WORKSPACE_ROUTE_ROLES } from '../src/components/workspace-access';
import { WorkspaceRoute } from '../src/components/workspace-route';
import { OverviewScreen } from '../src/features/overview/overview-screen';

export default function OverviewPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.overview}>
      <OverviewScreen />
    </WorkspaceRoute>
  );
}

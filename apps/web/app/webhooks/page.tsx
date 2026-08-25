import type { Metadata } from 'next';

import { WORKSPACE_ROUTE_ROLES } from '../../src/components/workspace-access';
import { WorkspaceRoute } from '../../src/components/workspace-route';
import { WebhooksScreen } from '../../src/features/webhooks/webhooks-screen';

export const metadata: Metadata = { title: 'Delivery connections' };

export default function WebhooksPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.webhookActivity}>
      <WebhooksScreen />
    </WorkspaceRoute>
  );
}

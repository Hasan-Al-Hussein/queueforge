import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StatePanel } from '@queueforge/ui';

import { WORKSPACE_ROUTE_ROLES } from '../../../src/components/workspace-access';
import { WorkspaceRoute } from '../../../src/components/workspace-route';
import { RequestDetailScreen } from '../../../src/features/requests/request-detail-screen';

export const metadata: Metadata = { title: 'Request detail' };

export default function RequestDetailPage(): React.JSX.Element {
  return (
    <WorkspaceRoute allowedRoles={WORKSPACE_ROUTE_ROLES.requestDetail}>
      <Suspense
        fallback={
          <main className="qf-session-gate">
            <StatePanel
              description="Reading the request identifier from this static route."
              kind="loading"
              title="Opening request"
            />
          </main>
        }
      >
        <RequestDetailScreen />
      </Suspense>
    </WorkspaceRoute>
  );
}

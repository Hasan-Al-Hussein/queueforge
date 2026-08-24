import type { Metadata } from 'next';
import { Suspense } from 'react';

import { StatePanel } from '@queueforge/ui';

import { RequestDetailScreen } from '../../../src/features/requests/request-detail-screen';

export const metadata: Metadata = { title: 'Request detail' };

export default function RequestDetailPage(): React.JSX.Element {
  return (
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
  );
}

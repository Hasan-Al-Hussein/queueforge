import type { Metadata } from 'next';

import { WebhooksScreen } from '../../src/features/webhooks/webhooks-screen';

export const metadata: Metadata = { title: 'Webhooks' };

export default function WebhooksPage(): React.JSX.Element {
  return <WebhooksScreen />;
}

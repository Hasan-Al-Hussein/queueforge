import type { Metadata } from 'next';

import { RequestsScreen } from '../../src/features/requests/requests-screen';

export const metadata: Metadata = { title: 'Requests' };

export default function RequestsPage(): React.JSX.Element {
  return <RequestsScreen />;
}

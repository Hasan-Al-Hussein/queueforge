import type { Metadata } from 'next';

import { OperationsScreen } from '../../src/features/operations/operations-screen';

export const metadata: Metadata = { title: 'Queues & DLQ' };

export default function OperationsPage(): React.JSX.Element {
  return <OperationsScreen />;
}

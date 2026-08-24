import type { Metadata } from 'next';

import { ApprovalsScreen } from '../../src/features/approvals/approvals-screen';

export const metadata: Metadata = { title: 'Approvals' };

export default function ApprovalsPage(): React.JSX.Element {
  return <ApprovalsScreen />;
}

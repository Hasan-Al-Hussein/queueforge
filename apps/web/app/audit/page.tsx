import type { Metadata } from 'next';

import { AuditScreen } from '../../src/features/audit/audit-screen';

export const metadata: Metadata = { title: 'Audit trail' };

export default function AuditPage(): React.JSX.Element {
  return <AuditScreen />;
}

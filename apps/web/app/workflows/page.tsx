import type { Metadata } from 'next';

import { WorkflowsScreen } from '../../src/features/workflows/workflows-screen';

export const metadata: Metadata = { title: 'Workflows' };

export default function WorkflowsPage(): React.JSX.Element {
  return <WorkflowsScreen />;
}

import type { Metadata } from 'next';

import { TeamScreen } from '../../src/features/team/team-screen';

export const metadata: Metadata = { title: 'Team & access' };

export default function TeamPage(): React.JSX.Element {
  return <TeamScreen />;
}

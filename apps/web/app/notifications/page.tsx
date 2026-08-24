import type { Metadata } from 'next';

import { NotificationsScreen } from '../../src/features/notifications/notifications-screen';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage(): React.JSX.Element {
  return <NotificationsScreen />;
}

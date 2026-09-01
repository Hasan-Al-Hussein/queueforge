import type { Notification } from '../../domain/models';

export interface NotificationPresentation {
  readonly heading: string;
  readonly label: string;
  readonly status: string;
}

export interface NotificationPageCounts {
  readonly action: number;
  readonly problems: number;
  readonly unread: number;
}

export function notificationPresentation(
  notification: Pick<Notification, 'body' | 'kind' | 'title'>,
): NotificationPresentation {
  const content = `${notification.title} ${notification.body}`.toLowerCase();
  if (content.includes('request approved')) {
    return { heading: 'Request approved', label: 'Approved', status: 'succeeded' };
  }
  if (content.includes('request rejected')) {
    return { heading: 'Request rejected', label: 'Rejected', status: 'failed' };
  }
  if (
    content.includes('approval required') ||
    (notification.title.toLowerCase().includes('approval') &&
      notification.body.toLowerCase().startsWith('review '))
  ) {
    return { heading: 'Approval needed', label: 'Action needed', status: 'pending_approval' };
  }
  if (notification.kind === 'error') {
    return { heading: notification.title, label: 'Problem', status: 'failed' };
  }
  if (notification.kind === 'warning') {
    return { heading: notification.title, label: 'Attention', status: 'retry' };
  }
  if (notification.kind === 'success') {
    return { heading: notification.title, label: 'Delivered', status: 'succeeded' };
  }
  return { heading: notification.title, label: 'Update', status: 'active' };
}

export function notificationPageCounts(
  notifications: readonly Pick<Notification, 'body' | 'kind' | 'readAt' | 'title'>[],
): NotificationPageCounts {
  return notifications.reduce<NotificationPageCounts>(
    (counts, notification) => {
      const presentation = notificationPresentation(notification);
      return {
        action: counts.action + (presentation.label === 'Action needed' ? 1 : 0),
        problems: counts.problems + (presentation.label === 'Problem' ? 1 : 0),
        unread: counts.unread + (notification.readAt === null ? 1 : 0),
      };
    },
    { action: 0, problems: 0, unread: 0 },
  );
}

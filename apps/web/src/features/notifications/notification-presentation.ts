import type { Notification } from '../../domain/models';

export interface NotificationPresentation {
  readonly heading: string;
  readonly label: string;
  readonly status: string;
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

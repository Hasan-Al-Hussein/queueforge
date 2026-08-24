import { Injectable, Logger } from '@nestjs/common';

import type { NotificationMessage, NotificationProviderPort, TenantScope } from '../core/ports.js';

@Injectable()
export class ConsoleNotificationProvider implements NotificationProviderPort {
  public readonly name = 'console' as const;
  private readonly logger = new Logger(ConsoleNotificationProvider.name);

  public deliver(scope: TenantScope, notification: NotificationMessage): Promise<void> {
    // The body may contain user data. The local provider logs routing metadata only.
    this.logger.log(
      {
        notificationId: notification.id,
        recipientKind: notification.recipientKind,
        tenantId: scope.tenantId,
        titleLength: notification.title.length,
      },
      'Local notification delivered',
    );
    return Promise.resolve();
  }
}

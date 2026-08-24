import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { NotificationStore, ProcessedEventStore } from '@queueforge/persistence';

import { safeErrorMessage } from '../core/errors.js';
import { parseEventEnvelope } from '../core/jobs.js';
import { NOTIFICATION_PROVIDER, type NotificationProviderPort } from '../core/ports.js';

const NOTIFICATION_CONSUMER = 'queueforge.notification-console.v1';
const NotificationJobPayloadSchema = z.object({ notificationId: z.string().uuid() }).passthrough();

@Injectable()
export class NotificationJobHandlerService {
  private readonly logger = new Logger(NotificationJobHandlerService.name);

  public constructor(
    private readonly processedEvents: ProcessedEventStore,
    private readonly notifications: NotificationStore,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProviderPort,
  ) {}

  public async handle(job: Job): Promise<void> {
    const event = parseEventEnvelope(job.data);
    if (await this.processedEvents.has(event.tenantId, NOTIFICATION_CONSUMER, event.eventId)) {
      return;
    }
    const scope = { tenantId: event.tenantId };
    const { notificationId } = NotificationJobPayloadSchema.parse(event.payload);
    const notification = await this.notifications.get(scope, notificationId);
    if (notification === null) {
      throw new Error('Notification record is unavailable');
    }

    try {
      await this.provider.deliver(scope, notification);
    } catch (error) {
      await this.notifications.recordDeliveryOnce(
        scope,
        event.eventId,
        NOTIFICATION_CONSUMER,
        notificationId,
        this.provider.name,
        {
          delivered: false,
          errorMessage: safeErrorMessage(error),
        },
      );
      this.logger.error(
        { notificationId, tenantId: event.tenantId },
        'Local notification provider failed',
      );
      return;
    }
    await this.notifications.recordDeliveryOnce(
      scope,
      event.eventId,
      NOTIFICATION_CONSUMER,
      notificationId,
      this.provider.name,
      { delivered: true },
    );
  }
}

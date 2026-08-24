import { Injectable } from '@nestjs/common';

import type { TenantContext, TenantRole } from '@queueforge/contracts';
import { createIdempotencyFingerprint, sha256Hex } from '@queueforge/domain';
import { OperationsStore, ReadModelStore } from '@queueforge/persistence';

import { requireAnyRole } from './authorization.js';

@Injectable()
export class OperationsService {
  public constructor(
    private readonly operations: OperationsStore,
    private readonly readModels: ReadModelStore,
  ) {}

  public databaseReady(): Promise<void> {
    return this.readModels.ping();
  }

  public dashboard(context: TenantContext): ReturnType<ReadModelStore['dashboard']> {
    return this.readModels.dashboard(context);
  }

  public queueOverview(context: TenantContext): ReturnType<ReadModelStore['queueOverview']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.readModels.queueOverview(context);
  }

  public deadLetters(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): ReturnType<ReadModelStore['listDeadLetters']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.readModels.listDeadLetters(context, page, pageSize);
  }

  public retryDeadLetter(
    context: TenantContext,
    deadLetterId: string,
    correlationId: string,
  ): ReturnType<OperationsStore['retryDeadLetter']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.operations.retryDeadLetter(context, deadLetterId, correlationId);
  }

  public cancelRequest(
    context: TenantContext,
    requestId: string,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<OperationsStore['commandRequest']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.operations.commandRequest(context, requestId, 'cancel', {
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'workflow-request.cancel',
        principalId: context.principalId,
        request: { requestId },
      }),
    });
  }

  public retryRequest(
    context: TenantContext,
    requestId: string,
    idempotencyKey: string,
    correlationId: string,
  ): ReturnType<OperationsStore['commandRequest']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.operations.commandRequest(context, requestId, 'retry', {
      correlationId,
      idempotencyKeyHash: sha256Hex(idempotencyKey),
      requestFingerprint: createIdempotencyFingerprint({
        operation: 'workflow-request.retry',
        principalId: context.principalId,
        request: { requestId },
      }),
    });
  }

  public notifications(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): ReturnType<ReadModelStore['listNotifications']> {
    return this.readModels.listNotifications(context, page, pageSize);
  }

  public markNotificationRead(
    context: TenantContext,
    notificationId: string,
  ): ReturnType<OperationsStore['markNotificationRead']> {
    return this.operations.markNotificationRead(context, notificationId);
  }

  public team(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): ReturnType<ReadModelStore['listTeam']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.readModels.listTeam(context, page, pageSize);
  }

  public updateMembership(
    context: TenantContext,
    userId: string,
    role: TenantRole,
    correlationId: string,
  ): ReturnType<OperationsStore['updateMembershipRole']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.operations.updateMembershipRole(context, userId, role, correlationId);
  }

  public audit(
    context: TenantContext,
    page: number,
    pageSize: number,
    eventTypePrefix?: string,
  ): ReturnType<ReadModelStore['listAudit']> {
    requireAnyRole(context, ['tenant_admin', 'platform_admin']);
    return this.readModels.listAudit(context, page, pageSize, eventTypePrefix);
  }

  public webhookEndpoints(
    context: TenantContext,
  ): ReturnType<ReadModelStore['listWebhookEndpoints']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.readModels.listWebhookEndpoints(context);
  }

  public webhookDeliveries(
    context: TenantContext,
    page: number,
    pageSize: number,
  ): ReturnType<ReadModelStore['listWebhookDeliveries']> {
    requireAnyRole(context, ['operator', 'tenant_admin', 'platform_admin']);
    return this.readModels.listWebhookDeliveries(context, page, pageSize);
  }
}

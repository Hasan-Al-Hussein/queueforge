export * from './base.entity.js';
export * from './event.entities.js';
export * from './identity.entities.js';
export * from './request.entities.js';
export * from './webhook.entities.js';
export * from './workflow.entities.js';

import {
  AuditEventEntity,
  NotificationDeliveryEntity,
  NotificationEntity,
  OutboxAttemptEntity,
  OutboxEventEntity,
  ProcessedEventEntity,
  WorkerNodeEntity,
} from './event.entities.js';
import {
  ApiClientEntity,
  MembershipEntity,
  RefreshTokenEntity,
  RefreshTokenFamilyEntity,
  SecurityEventEntity,
  TenantEntity,
  UserEntity,
} from './identity.entities.js';
import {
  ApprovalDecisionEntity,
  ApprovalTaskEntity,
  DeadLetterEntity,
  IdempotencyRecordEntity,
  RequestAttemptEntity,
  RequestTransitionEntity,
  WorkflowRequestEntity,
} from './request.entities.js';
import {
  InboundWebhookReceiptEntity,
  InboundWebhookReplayKeyEntity,
  WebhookDeliveryAttemptEntity,
  WebhookDeliveryEntity,
  WebhookEndpointEntity,
  WebhookSecretEntity,
} from './webhook.entities.js';
import {
  WorkflowTargetEntity,
  WorkflowTemplateEntity,
  WorkflowVersionEntity,
} from './workflow.entities.js';

export const persistenceEntities = [
  TenantEntity,
  UserEntity,
  MembershipEntity,
  ApiClientEntity,
  RefreshTokenFamilyEntity,
  RefreshTokenEntity,
  SecurityEventEntity,
  WorkflowTemplateEntity,
  WorkflowVersionEntity,
  WorkflowTargetEntity,
  WorkflowRequestEntity,
  RequestTransitionEntity,
  RequestAttemptEntity,
  ApprovalTaskEntity,
  ApprovalDecisionEntity,
  IdempotencyRecordEntity,
  DeadLetterEntity,
  OutboxEventEntity,
  OutboxAttemptEntity,
  ProcessedEventEntity,
  AuditEventEntity,
  NotificationEntity,
  NotificationDeliveryEntity,
  WorkerNodeEntity,
  WebhookEndpointEntity,
  WebhookSecretEntity,
  InboundWebhookReplayKeyEntity,
  InboundWebhookReceiptEntity,
  WebhookDeliveryEntity,
  WebhookDeliveryAttemptEntity,
] as const;

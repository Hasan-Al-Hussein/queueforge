import { z } from 'zod';

import {
  MembershipSchema,
  PageMetaSchema,
  WorkflowRequestStatusSchema,
  WorkflowRequestViewSchema,
  WorkflowSummarySchema,
  WorkflowTargetsSchema,
  type TenantRole as ContractTenantRole,
} from '@queueforge/contracts';

const TimestampSchema = z.string().datetime({ offset: true });
const UuidSchema = z.string().uuid();

export const DashboardOverviewSchema = z
  .object({
    statusCounts: z.array(
      z
        .object({ status: WorkflowRequestStatusSchema, count: z.number().int().nonnegative() })
        .strict(),
    ),
    queues: z.array(
      z
        .object({
          name: z.string(),
          waiting: z.number().int().nonnegative(),
          active: z.number().int().nonnegative(),
          delayed: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    recentRequests: z.array(WorkflowRequestViewSchema),
    throughput: z.array(
      z
        .object({
          bucket: TimestampSchema,
          succeeded: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();
export type DashboardOverview = z.infer<typeof DashboardOverviewSchema>;

export const RequestTransitionSchema = z
  .object({
    id: UuidSchema,
    fromStatus: WorkflowRequestStatusSchema.nullable(),
    toStatus: WorkflowRequestStatusSchema,
    reason: z.string().nullable().optional(),
    actorName: z.string().nullable().optional(),
    occurredAt: TimestampSchema,
  })
  .strict();
export type RequestTransition = z.infer<typeof RequestTransitionSchema>;

export const RequestDetailSchema = z
  .object({
    request: WorkflowRequestViewSchema,
    transitions: z.array(RequestTransitionSchema),
    approval: z
      .object({
        id: UuidSchema,
        status: z.enum(['pending', 'approved', 'rejected']),
        requestedBy: z.string(),
        decidedBy: z.string().nullable(),
        note: z.string().nullable(),
        revision: z.number().int().positive(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RequestDetail = z.infer<typeof RequestDetailSchema>;

export const ApprovalTaskSchema = z
  .object({
    id: UuidSchema,
    requestId: UuidSchema,
    workflowName: z.string(),
    requestedById: UuidSchema,
    requestedByName: z.string(),
    payloadSummary: z.string(),
    status: z.enum(['pending', 'approved', 'rejected']),
    revision: z.number().int().positive(),
    createdAt: TimestampSchema,
  })
  .strict();
export type ApprovalTask = z.infer<typeof ApprovalTaskSchema>;

export const WorkflowDetailSchema = WorkflowSummarySchema.extend({
  requestSchema: z.record(z.string(), z.unknown()),
  preventSelfApproval: z.boolean(),
  processingConfig: z.record(z.string(), z.unknown()),
  targets: WorkflowTargetsSchema,
});
export type WorkflowDetail = z.infer<typeof WorkflowDetailSchema>;

export const WebhookEndpointSchema = z
  .object({
    id: UuidSchema,
    name: z.string(),
    url: z.string().url(),
    active: z.boolean(),
    keyId: z.string(),
    updatedAt: TimestampSchema,
  })
  .strict();
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;

export const CreatedWebhookEndpointSchema = z
  .object({
    endpoint: WebhookEndpointSchema,
    signingSecret: z.string().min(1).nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type CreatedWebhookEndpoint = z.infer<typeof CreatedWebhookEndpointSchema>;

export const WebhookDeliverySchema = z
  .object({
    id: UuidSchema,
    endpointName: z.string(),
    eventType: z.string(),
    eventId: UuidSchema,
    status: z.enum(['pending', 'delivering', 'retry', 'delivered', 'dead']),
    attemptCount: z.number().int().nonnegative(),
    nextAttemptAt: TimestampSchema.nullable(),
    lastStatusCode: z.number().int().nullable(),
    updatedAt: TimestampSchema,
  })
  .strict();
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const QueueSnapshotSchema = z
  .object({
    name: z.string(),
    waiting: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    heartbeatAt: TimestampSchema.nullable(),
    paused: z.boolean(),
    outboxBacklog: z.number().int().nonnegative(),
    outboxDead: z.number().int().nonnegative(),
    telemetryAvailable: z.boolean(),
    workerCount: z.number().int().nonnegative(),
    workerState: z.enum(['running', 'draining', 'offline', 'unavailable']),
  })
  .strict();
export type QueueSnapshot = z.infer<typeof QueueSnapshotSchema>;

export const DeadLetterSchema = z
  .object({
    id: UuidSchema,
    requestId: UuidSchema,
    workflowName: z.string(),
    reason: z.string(),
    attemptCount: z.number().int().nonnegative(),
    deadLetteredAt: TimestampSchema,
  })
  .strict();
export type DeadLetter = z.infer<typeof DeadLetterSchema>;

export const NotificationSchema = z
  .object({
    id: UuidSchema,
    title: z.string(),
    body: z.string(),
    kind: z.enum(['info', 'success', 'warning', 'error']),
    readAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .strict();
export type Notification = z.infer<typeof NotificationSchema>;

export const AuditEventSchema = z
  .object({
    id: UuidSchema,
    eventType: z.string(),
    actorName: z.string().nullable(),
    resourceType: z.string(),
    resourceId: UuidSchema.nullable(),
    summary: z.string(),
    correlationId: UuidSchema,
    occurredAt: TimestampSchema,
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const TeamMemberSchema = MembershipSchema.pick({ role: true }).extend({
  id: UuidSchema,
  displayName: z.string(),
  email: z.string().email(),
  status: z.enum(['active', 'invited', 'disabled']),
  joinedAt: TimestampSchema,
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const PagedRequestsSchema = z
  .object({ items: z.array(WorkflowRequestViewSchema), meta: PageMetaSchema })
  .strict();
export const PagedApprovalsSchema = z
  .object({ items: z.array(ApprovalTaskSchema), meta: PageMetaSchema })
  .strict();
export const PagedDeliveriesSchema = z
  .object({ items: z.array(WebhookDeliverySchema), meta: PageMetaSchema })
  .strict();
export const PagedDeadLettersSchema = z
  .object({ items: z.array(DeadLetterSchema), meta: PageMetaSchema })
  .strict();
export const PagedNotificationsSchema = z
  .object({ items: z.array(NotificationSchema), meta: PageMetaSchema })
  .strict();
export const PagedAuditSchema = z
  .object({ items: z.array(AuditEventSchema), meta: PageMetaSchema })
  .strict();
export const PagedTeamSchema = z
  .object({ items: z.array(TeamMemberSchema), meta: PageMetaSchema })
  .strict();

export const WorkflowListSchema = z.array(WorkflowSummarySchema);
export const WebhookEndpointListSchema = z.array(WebhookEndpointSchema);
export const QueueSnapshotListSchema = z.array(QueueSnapshotSchema);

export type TenantRole = ContractTenantRole;

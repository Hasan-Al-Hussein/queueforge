import { z } from 'zod';

import { TenantRoleSchema } from './identity.js';

export const WorkflowVersionStatusSchema = z.enum(['draft', 'active', 'retired']);
export type WorkflowVersionStatus = z.infer<typeof WorkflowVersionStatusSchema>;

export const WorkflowRequestStatusSchema = z.enum([
  'received',
  'validation_failed',
  'pending_approval',
  'approved',
  'rejected',
  'queued',
  'processing',
  'succeeded',
  'failed',
  'dead_lettered',
  'cancelled',
]);
export type WorkflowRequestStatus = z.infer<typeof WorkflowRequestStatusSchema>;

export const RequestSourceSchema = z.enum(['rest', 'graphql', 'inbound_webhook', 'system']);
export type RequestSource = z.infer<typeof RequestSourceSchema>;

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObjectSchema>;

export const WorkflowTargetKindSchema = z.enum(['processor', 'webhook', 'notification']);
export type WorkflowTargetKind = z.infer<typeof WorkflowTargetKindSchema>;

export const ProcessorTargetConfigSchema = z
  .object({
    handler: z.literal('demo'),
  })
  .strict();

export const WebhookTargetConfigSchema = z
  .object({
    endpointId: z.string().uuid(),
  })
  .strict();

export const NotificationTargetConfigSchema = z.discriminatedUnion('recipientKind', [
  z
    .object({
      recipientKind: z.literal('user'),
      recipientRef: z.string().uuid(),
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4_000).optional(),
    })
    .strict(),
  z
    .object({
      recipientKind: z.literal('role'),
      recipientRef: TenantRoleSchema,
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4_000).optional(),
    })
    .strict(),
]);

export const WorkflowProcessingConfigSchema = z
  .object({
    durationMs: z.number().int().min(0).max(10_000).default(250),
    failuresBeforeSuccess: z.number().int().min(0).max(10).default(0),
    maxAttempts: z.number().int().min(1).max(25).default(5),
  })
  .strict();
export type WorkflowProcessingConfig = z.infer<typeof WorkflowProcessingConfigSchema>;

export const WorkflowTargetInputSchema = z
  .object({
    targetKind: WorkflowTargetKindSchema,
    position: z.number().int().min(0).max(99),
    config: JsonObjectSchema,
  })
  .strict();
export type WorkflowTargetInput = z.infer<typeof WorkflowTargetInputSchema>;

export const WorkflowTargetsSchema = z
  .array(WorkflowTargetInputSchema)
  .max(20)
  .superRefine((targets, context) => {
    const positions = new Set<number>();
    const processorIndexes: number[] = [];
    for (const [index, target] of targets.entries()) {
      if (positions.has(target.position)) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow target positions must be unique',
          path: [index, 'position'],
        });
      }
      positions.add(target.position);
      if (target.targetKind === 'processor') {
        processorIndexes.push(index);
      }
      const configSchema =
        target.targetKind === 'processor'
          ? ProcessorTargetConfigSchema
          : target.targetKind === 'webhook'
            ? WebhookTargetConfigSchema
            : NotificationTargetConfigSchema;
      const configResult = configSchema.safeParse(target.config);
      if (!configResult.success) {
        for (const issue of configResult.error.issues) {
          context.addIssue({
            code: 'custom',
            message: issue.message,
            path: [index, 'config', ...issue.path],
          });
        }
      }
    }
    if (processorIndexes.length !== 1) {
      context.addIssue({
        code: 'custom',
        message: 'A workflow must define exactly one processor target',
        path: [],
      });
    }
  });

export const WorkflowSummarySchema = z
  .object({
    id: z.string().uuid(),
    stableKey: z.string().min(2).max(100),
    name: z.string().min(1).max(160),
    description: z.string().max(2_000).nullable(),
    versionId: z.string().uuid(),
    versionNo: z.number().int().positive(),
    versionStatus: WorkflowVersionStatusSchema,
    requiresApproval: z.boolean(),
    isEnabled: z.boolean(),
    revision: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type WorkflowSummary = z.infer<typeof WorkflowSummarySchema>;

export const SubmitWorkflowRequestSchema = z
  .object({
    workflowKey: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    payload: JsonObjectSchema,
  })
  .strict();
export type SubmitWorkflowRequest = z.infer<typeof SubmitWorkflowRequestSchema>;

export const WorkflowRequestViewSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().uuid(),
    workflowVersionId: z.string().uuid(),
    workflowName: z.string().min(1),
    versionNo: z.number().int().positive(),
    status: WorkflowRequestStatusSchema,
    source: RequestSourceSchema,
    payload: JsonObjectSchema,
    correlationId: z.string().uuid(),
    submittedAt: z.string().datetime({ offset: true }),
    statusChangedAt: z.string().datetime({ offset: true }),
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
  })
  .strict();
export type WorkflowRequestView = z.infer<typeof WorkflowRequestViewSchema>;

export const ApprovalDecisionInputSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    note: z.string().trim().max(2_000).optional(),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInputSchema>;

export const DraftAutosaveInputSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    description: z.string().max(2_000).nullable(),
    requestSchema: JsonObjectSchema,
    requiresApproval: z.boolean(),
    preventSelfApproval: z.boolean(),
    processingConfig: WorkflowProcessingConfigSchema,
    targets: WorkflowTargetsSchema,
    isEnabled: z.boolean(),
  })
  .strict();
export type DraftAutosaveInput = z.infer<typeof DraftAutosaveInputSchema>;

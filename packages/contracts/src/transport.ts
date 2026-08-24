import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, EVENT_SCHEMA_VERSION, MAX_PAGE_SIZE } from './constants.js';
import { JsonObjectSchema, WorkflowRequestStatusSchema } from './workflows.js';

export const UuidSchema = z.string().uuid();

export const ErrorCodeSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'AUTHORIZATION_DENIED',
  'CSRF_VALIDATION_FAILED',
  'INVALID_CREDENTIALS',
  'TOKEN_REUSE_DETECTED',
  'TENANT_CONTEXT_REQUIRED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSE',
  'STALE_REVISION',
  'INVALID_STATE_TRANSITION',
  'SELF_APPROVAL_FORBIDDEN',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_REPLAY_DETECTED',
  'WEBHOOK_TARGET_BLOCKED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string().min(1).max(500),
        details: JsonObjectSchema.optional(),
      })
      .strict(),
    requestId: UuidSchema,
    correlationId: UuidSchema,
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const PageQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  })
  .strict();
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const RequestListQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().min(1).max(160).optional(),
  sortBy: z
    .enum(['submittedAt', 'workflowName', 'status', 'source', 'attemptCount'])
    .default('submittedAt'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
  status: WorkflowRequestStatusSchema.optional(),
}).strict();
export type RequestListQuery = z.infer<typeof RequestListQuerySchema>;

export const PageMetaSchema = z
  .object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive().max(MAX_PAGE_SIZE),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .strict();
export type PageMeta = z.infer<typeof PageMetaSchema>;

export const EventEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(EVENT_SCHEMA_VERSION),
    eventId: z.string().uuid(),
    tenantId: z.string().uuid(),
    eventType: z.string().min(3).max(160),
    aggregateType: z.string().min(1).max(80),
    aggregateId: z.string().uuid(),
    correlationId: z.string().uuid(),
    occurredAt: z.string().datetime({ offset: true }),
    payload: JsonObjectSchema,
  })
  .strict();
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const WebhookReceiptSchema = z
  .object({
    accepted: z.boolean(),
    duplicate: z.boolean(),
    eventId: z.string().uuid(),
    requestId: z.string().uuid().optional(),
  })
  .strict();
export type WebhookReceipt = z.infer<typeof WebhookReceiptSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.string().min(1),
    version: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
  })
  .strict();
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

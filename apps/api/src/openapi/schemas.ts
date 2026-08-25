import type { SchemaObject } from '@nestjs/swagger';

const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const dateTime: SchemaObject = { type: 'string', format: 'date-time' };
const nullableDateTime: SchemaObject = { ...dateTime, nullable: true };
const nonNegativeInteger: SchemaObject = { type: 'integer', minimum: 0 };

export const TENANT_ROLES = ['viewer', 'approver', 'operator', 'tenant_admin'];
export const REQUEST_STATUSES = [
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
];

export const JSON_OBJECT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: true,
  description: 'A JSON object. Its accepted fields are defined by the selected workflow.',
};

export const ERROR_ENVELOPE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'requestId', 'correlationId', 'timestamp'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          description: 'Stable machine-readable QueueForge error code.',
          example: 'VALIDATION_FAILED',
        },
        message: { type: 'string', example: 'The submitted value is invalid' },
        details: { ...JSON_OBJECT_SCHEMA, description: 'Optional safe structured error details.' },
      },
    },
    requestId: uuid,
    correlationId: uuid,
    timestamp: dateTime,
  },
};

export const MEMBERSHIP_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'tenantName', 'tenantSlug', 'role'],
  properties: {
    tenantId: uuid,
    tenantName: { type: 'string', maxLength: 160 },
    tenantSlug: { type: 'string', minLength: 2, maxLength: 80 },
    role: { type: 'string', enum: TENANT_ROLES },
  },
};

const userSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'displayName', 'email', 'platformRole'],
  properties: {
    id: uuid,
    displayName: { type: 'string' },
    email: { type: 'string', format: 'email' },
    platformRole: { type: 'string', enum: ['platform_admin'], nullable: true },
  },
};

export const AUTH_SESSION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'accessToken',
    'accessTokenExpiresAt',
    'csrfToken',
    'memberships',
    'selectedTenant',
    'user',
  ],
  properties: {
    accessToken: { type: 'string', description: 'Short-lived bearer JWT.' },
    accessTokenExpiresAt: dateTime,
    csrfToken: { type: 'string', minLength: 32, description: 'Double-submit CSRF token.' },
    memberships: { type: 'array', items: MEMBERSHIP_SCHEMA },
    selectedTenant: MEMBERSHIP_SCHEMA,
    user: userSchema,
  },
};

export const CURRENT_SESSION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['memberships', 'selectedTenant', 'user'],
  properties: {
    memberships: { type: 'array', items: MEMBERSHIP_SCHEMA },
    selectedTenant: MEMBERSHIP_SCHEMA,
    user: userSchema,
  },
};

export const LOGIN_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 320 },
    password: { type: 'string', format: 'password', minLength: 12, maxLength: 256 },
    tenantId: uuid,
  },
};

export const WORKFLOW_SUMMARY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'stableKey',
    'name',
    'description',
    'versionId',
    'versionNo',
    'versionStatus',
    'requiresApproval',
    'isEnabled',
    'revision',
    'updatedAt',
  ],
  properties: {
    id: uuid,
    stableKey: { type: 'string', minLength: 2, maxLength: 100 },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 2_000, nullable: true },
    versionId: uuid,
    versionNo: { type: 'integer', minimum: 1 },
    versionStatus: { type: 'string', enum: ['draft', 'active', 'retired'] },
    requiresApproval: { type: 'boolean' },
    isEnabled: { type: 'boolean' },
    revision: { type: 'integer', minimum: 1 },
    updatedAt: dateTime,
  },
};

const workflowTargetSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['targetKind', 'position', 'config'],
  properties: {
    targetKind: { type: 'string', enum: ['processor', 'webhook', 'notification'] },
    position: { type: 'integer', minimum: 0, maximum: 99 },
    config: JSON_OBJECT_SCHEMA,
  },
};

export const WORKFLOW_DRAFT_SCHEMA: SchemaObject = {
  allOf: [
    WORKFLOW_SUMMARY_SCHEMA,
    {
      type: 'object',
      additionalProperties: false,
      required: ['requestSchema', 'preventSelfApproval', 'processingConfig', 'targets'],
      properties: {
        requestSchema: JSON_OBJECT_SCHEMA,
        preventSelfApproval: { type: 'boolean' },
        processingConfig: {
          type: 'object',
          additionalProperties: false,
          required: ['durationMs', 'failuresBeforeSuccess', 'maxAttempts'],
          properties: {
            durationMs: { type: 'integer', minimum: 0, maximum: 10_000 },
            failuresBeforeSuccess: { type: 'integer', minimum: 0, maximum: 10 },
            maxAttempts: { type: 'integer', minimum: 1, maximum: 25 },
          },
        },
        targets: { type: 'array', maxItems: 20, items: workflowTargetSchema },
      },
    },
  ],
};

export const DRAFT_AUTOSAVE_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'expectedRevision',
    'name',
    'description',
    'requestSchema',
    'requiresApproval',
    'preventSelfApproval',
    'processingConfig',
    'targets',
    'isEnabled',
  ],
  properties: {
    expectedRevision: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 160 },
    description: { type: 'string', maxLength: 2_000, nullable: true },
    requestSchema: JSON_OBJECT_SCHEMA,
    requiresApproval: { type: 'boolean' },
    preventSelfApproval: { type: 'boolean' },
    processingConfig: {
      type: 'object',
      additionalProperties: false,
      required: ['durationMs', 'failuresBeforeSuccess', 'maxAttempts'],
      properties: {
        durationMs: { type: 'integer', minimum: 0, maximum: 10_000 },
        failuresBeforeSuccess: { type: 'integer', minimum: 0, maximum: 10 },
        maxAttempts: { type: 'integer', minimum: 1, maximum: 25 },
      },
    },
    targets: { type: 'array', maxItems: 20, items: workflowTargetSchema },
    isEnabled: { type: 'boolean' },
  },
};

export const REQUEST_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['workflowKey', 'payload'],
  properties: {
    workflowKey: { type: 'string', minLength: 2, maxLength: 100, pattern: '^[a-z0-9][a-z0-9_-]*$' },
    payload: JSON_OBJECT_SCHEMA,
  },
};

export const WORKFLOW_REQUEST_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'workflowId',
    'workflowVersionId',
    'workflowName',
    'versionNo',
    'status',
    'source',
    'payload',
    'correlationId',
    'submittedAt',
    'statusChangedAt',
    'attemptCount',
    'maxAttempts',
  ],
  properties: {
    id: uuid,
    workflowId: uuid,
    workflowVersionId: uuid,
    workflowName: { type: 'string' },
    versionNo: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: REQUEST_STATUSES },
    source: { type: 'string', enum: ['rest', 'graphql', 'inbound_webhook', 'system'] },
    payload: JSON_OBJECT_SCHEMA,
    correlationId: uuid,
    submittedAt: dateTime,
    statusChangedAt: dateTime,
    attemptCount: nonNegativeInteger,
    maxAttempts: { type: 'integer', minimum: 1 },
  },
};

export const REQUEST_TRANSITION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'fromStatus', 'toStatus', 'actorName', 'reason', 'occurredAt'],
  properties: {
    id: uuid,
    fromStatus: { type: 'string', enum: REQUEST_STATUSES, nullable: true },
    toStatus: { type: 'string', enum: REQUEST_STATUSES },
    actorName: { type: 'string', nullable: true },
    reason: { type: 'string', nullable: true },
    occurredAt: dateTime,
  },
};

export const APPROVAL_TASK_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'requestId',
    'status',
    'revision',
    'createdAt',
    'workflowName',
    'requestedById',
    'requestedByName',
    'payloadSummary',
  ],
  properties: {
    id: uuid,
    requestId: uuid,
    status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    revision: { type: 'integer', minimum: 1 },
    createdAt: dateTime,
    workflowName: { type: 'string' },
    requestedById: uuid,
    requestedByName: { type: 'string' },
    payloadSummary: { type: 'string', maxLength: 500 },
  },
};

export const APPROVAL_DECISION_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['decision', 'expectedRevision'],
  properties: {
    decision: { type: 'string', enum: ['approved', 'rejected'] },
    note: { type: 'string', maxLength: 2_000 },
    expectedRevision: { type: 'integer', minimum: 1 },
  },
};

export const APPROVAL_DECISION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['approvalId', 'requestId', 'decision', 'requestStatus', 'replayed'],
  properties: {
    approvalId: uuid,
    requestId: uuid,
    decision: { type: 'string', enum: ['approved', 'rejected'] },
    requestStatus: { type: 'string', enum: ['queued', 'rejected'] },
    replayed: { type: 'boolean' },
  },
};

export const WEBHOOK_ENDPOINT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'url', 'active', 'keyId', 'updatedAt'],
  properties: {
    id: uuid,
    name: { type: 'string', maxLength: 160 },
    url: { type: 'string', format: 'uri', maxLength: 2_048 },
    active: { type: 'boolean' },
    keyId: { type: 'string', maxLength: 80 },
    updatedAt: dateTime,
  },
};

export const CREATED_WEBHOOK_ENDPOINT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['endpoint', 'signingSecret', 'replayed'],
  properties: {
    endpoint: WEBHOOK_ENDPOINT_SCHEMA,
    signingSecret: {
      type: 'string',
      nullable: true,
      writeOnly: true,
      description: 'Shown once on first creation; null for an idempotent replay.',
    },
    replayed: { type: 'boolean' },
  },
};

export const WEBHOOK_DELIVERY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'endpointName',
    'eventType',
    'eventId',
    'status',
    'attemptCount',
    'nextAttemptAt',
    'lastStatusCode',
    'requestId',
    'updatedAt',
    'workflowName',
  ],
  properties: {
    id: uuid,
    endpointName: { type: 'string' },
    eventType: { type: 'string', nullable: true },
    eventId: uuid,
    status: { type: 'string', enum: ['pending', 'delivering', 'delivered', 'retry', 'dead'] },
    attemptCount: nonNegativeInteger,
    nextAttemptAt: nullableDateTime,
    lastStatusCode: { type: 'integer', nullable: true, minimum: 100, maximum: 599 },
    requestId: { ...uuid, nullable: true },
    updatedAt: dateTime,
    workflowName: { type: 'string', nullable: true },
  },
};

export const INBOUND_WEBHOOK_BODY_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['workflowKey', 'payload'],
  properties: {
    workflowKey: { type: 'string', minLength: 2, maxLength: 100 },
    payload: JSON_OBJECT_SCHEMA,
  },
};

export const WEBHOOK_RECEIPT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['accepted', 'duplicate', 'eventId'],
  properties: {
    accepted: { type: 'boolean' },
    duplicate: { type: 'boolean' },
    eventId: uuid,
    requestId: uuid,
  },
};

export const QUEUE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'waiting',
    'active',
    'delayed',
    'failed',
    'paused',
    'telemetryAvailable',
    'workerState',
    'workerCount',
    'heartbeatAt',
    'outboxBacklog',
    'outboxDead',
  ],
  properties: {
    name: { type: 'string' },
    waiting: nonNegativeInteger,
    active: nonNegativeInteger,
    delayed: nonNegativeInteger,
    failed: nonNegativeInteger,
    paused: { type: 'boolean' },
    telemetryAvailable: { type: 'boolean' },
    workerState: { type: 'string', enum: ['running', 'draining', 'offline', 'unavailable'] },
    workerCount: nonNegativeInteger,
    heartbeatAt: nullableDateTime,
    outboxBacklog: nonNegativeInteger,
    outboxDead: nonNegativeInteger,
  },
};

const dashboardQueueSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'waiting', 'active', 'delayed', 'failed'],
  properties: {
    name: { type: 'string' },
    waiting: nonNegativeInteger,
    active: nonNegativeInteger,
    delayed: nonNegativeInteger,
    failed: nonNegativeInteger,
  },
};

export const DASHBOARD_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['statusCounts', 'queues', 'recentRequests', 'throughput'],
  properties: {
    statusCounts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'count'],
        properties: {
          status: { type: 'string', enum: REQUEST_STATUSES },
          count: nonNegativeInteger,
        },
      },
    },
    queues: { type: 'array', items: dashboardQueueSchema },
    recentRequests: { type: 'array', items: WORKFLOW_REQUEST_SCHEMA, maxItems: 8 },
    throughput: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['bucket', 'succeeded', 'failed'],
        properties: {
          bucket: dateTime,
          succeeded: nonNegativeInteger,
          failed: nonNegativeInteger,
        },
      },
    },
  },
};

export const DEAD_LETTER_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'requestId', 'workflowName', 'reason', 'attemptCount', 'deadLetteredAt'],
  properties: {
    id: uuid,
    requestId: uuid,
    workflowName: { type: 'string' },
    reason: { type: 'string' },
    attemptCount: nonNegativeInteger,
    deadLetteredAt: dateTime,
  },
};

export const RETRIED_DEAD_LETTER_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['resourceKind', 'resourceId'],
  properties: {
    resourceKind: { type: 'string' },
    resourceId: uuid,
  },
};

export const NOTIFICATION_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'body', 'kind', 'readAt', 'requestId', 'createdAt', 'workflowName'],
  properties: {
    id: uuid,
    title: { type: 'string', maxLength: 200 },
    body: { type: 'string', maxLength: 4_000 },
    kind: { type: 'string', enum: ['info', 'success', 'warning', 'error'] },
    readAt: nullableDateTime,
    requestId: { ...uuid, nullable: true },
    createdAt: dateTime,
    workflowName: { type: 'string', nullable: true },
  },
};

export const AUDIT_EVENT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'eventType',
    'actorName',
    'resourceType',
    'resourceId',
    'summary',
    'correlationId',
    'occurredAt',
  ],
  properties: {
    id: uuid,
    eventType: { type: 'string', maxLength: 160 },
    actorName: { type: 'string', nullable: true },
    resourceType: { type: 'string' },
    resourceId: { type: 'string', nullable: true },
    summary: { type: 'string', maxLength: 500 },
    correlationId: uuid,
    occurredAt: dateTime,
  },
};

export const TEAM_MEMBER_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'displayName', 'role', 'roleLocked', 'status', 'joinedAt'],
  properties: {
    id: uuid,
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    role: { type: 'string', enum: TENANT_ROLES },
    roleLocked: {
      type: 'boolean',
      description: 'True when this membership has a fixed role that administrators cannot change.',
    },
    status: { type: 'string', enum: ['active', 'disabled'] },
    joinedAt: dateTime,
  },
};

export const TENANT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['tenantId', 'name', 'slug'],
  properties: {
    tenantId: uuid,
    name: { type: 'string', maxLength: 160 },
    slug: { type: 'string', minLength: 2, maxLength: 80 },
  },
};

export const API_CLIENT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'keyId', 'name', 'role', 'createdAt', 'lastUsedAt', 'revokedAt'],
  properties: {
    id: uuid,
    keyId: { type: 'string', pattern: '^qf_[0-9a-f]{24}$' },
    name: { type: 'string', maxLength: 160 },
    role: { type: 'string', enum: ['viewer', 'operator'] },
    createdAt: dateTime,
    lastUsedAt: nullableDateTime,
    revokedAt: nullableDateTime,
  },
};

export const CREATED_API_CLIENT_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['apiKey', 'client', 'replayed'],
  properties: {
    apiKey: {
      type: 'string',
      nullable: true,
      writeOnly: true,
      description: 'Shown once on first creation; null for an idempotent replay.',
    },
    client: API_CLIENT_SCHEMA,
    replayed: { type: 'boolean' },
  },
};

export const HEALTH_LIVE_SCHEMA: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['service', 'status', 'timestamp', 'version'],
  properties: {
    service: { type: 'string', example: 'queueforge-api' },
    status: { type: 'string', enum: ['ok'] },
    timestamp: dateTime,
    version: { type: 'string', example: '0.1.0' },
  },
};

export const HEALTH_READY_SCHEMA: SchemaObject = {
  allOf: [
    HEALTH_LIVE_SCHEMA,
    {
      type: 'object',
      required: ['dependencies'],
      properties: {
        dependencies: {
          type: 'object',
          additionalProperties: false,
          required: ['database', 'redis'],
          properties: {
            database: { type: 'string', enum: ['ready'] },
            redis: { type: 'string', enum: ['ready'] },
          },
        },
      },
    },
  ],
};

export function arraySchema(items: SchemaObject): SchemaObject {
  return { type: 'array', items };
}

export function pageSchema(items: SchemaObject): SchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'meta'],
    properties: {
      items: { type: 'array', items },
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['page', 'pageSize', 'totalItems', 'totalPages'],
        properties: {
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          totalItems: nonNegativeInteger,
          totalPages: nonNegativeInteger,
        },
      },
    },
  };
}

export const UUID_SCHEMA: SchemaObject = uuid;

import type { WorkflowSummary } from '@queueforge/contracts';

import type {
  ApprovalTask,
  AuditEvent,
  DeadLetter,
  Notification,
  QueueSnapshot,
  RequestDetail,
  TeamMember,
  WebhookDelivery,
  WebhookEndpoint,
  WorkflowDetail,
} from '../domain/models';

export const SHOWCASE_IDS = Object.freeze({
  approvalCompleted: '70000000-0000-4000-8000-000000000001',
  approvalPending: '70000000-0000-4000-8000-000000000002',
  correlationCompleted: 'a0000000-0000-4000-8000-000000000001',
  correlationPending: 'a0000000-0000-4000-8000-000000000002',
  endpoint: '50000000-0000-4000-8000-000000000001',
  expenseRequestCompleted: '60000000-0000-4000-8000-000000000001',
  expenseRequestPending: '60000000-0000-4000-8000-000000000002',
  expenseVersion: '40000000-0000-4000-8000-000000000001',
  expenseWorkflow: '30000000-0000-4000-8000-000000000001',
  operator: '20000000-0000-4000-8000-000000000003',
  approver: '20000000-0000-4000-8000-000000000002',
});

const expenseWorkflow: WorkflowDetail = {
  description: 'Submit an expense for independent review, bounded processing, and signed delivery.',
  id: SHOWCASE_IDS.expenseWorkflow,
  isEnabled: true,
  name: 'Expense review',
  preventSelfApproval: true,
  processingConfig: { durationMs: 420, failuresBeforeSuccess: 1, maxAttempts: 3 },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['amount', 'costCenter', 'summary'],
    properties: {
      amount: { type: 'number', minimum: 1, maximum: 100000, title: 'Amount (AED)' },
      costCenter: { type: 'string', minLength: 2, maxLength: 40, title: 'Cost center' },
      summary: { type: 'string', minLength: 3, maxLength: 500, title: 'Business purpose' },
    },
  },
  requiresApproval: true,
  revision: 4,
  stableKey: 'expense_review',
  targets: [
    { config: { handler: 'demo' }, position: 0, targetKind: 'processor' },
    {
      config: { endpointId: SHOWCASE_IDS.endpoint },
      position: 1,
      targetKind: 'webhook',
    },
    {
      config: {
        body: 'Your expense request has completed.',
        recipientKind: 'role',
        recipientRef: 'operator',
        title: 'Expense completed',
      },
      position: 2,
      targetKind: 'notification',
    },
  ],
  updatedAt: '2026-08-31T18:02:00.000Z',
  versionId: SHOWCASE_IDS.expenseVersion,
  versionNo: 2,
  versionStatus: 'active',
};

const accessWorkflow: WorkflowDetail = {
  description: 'Route an access change through a durable, inspectable control path.',
  id: '30000000-0000-4000-8000-000000000002',
  isEnabled: true,
  name: 'Access review',
  preventSelfApproval: true,
  processingConfig: { durationMs: 300, failuresBeforeSuccess: 0, maxAttempts: 3 },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['system', 'reason'],
    properties: {
      system: { type: 'string', minLength: 2, maxLength: 80, title: 'System' },
      reason: { type: 'string', minLength: 3, maxLength: 500, title: 'Reason' },
    },
  },
  requiresApproval: true,
  revision: 2,
  stableKey: 'access_review',
  targets: [{ config: { handler: 'demo' }, position: 0, targetKind: 'processor' }],
  updatedAt: '2026-08-30T14:18:00.000Z',
  versionId: '40000000-0000-4000-8000-000000000002',
  versionNo: 1,
  versionStatus: 'active',
};

const vendorWorkflow: WorkflowDetail = {
  description: 'Collect and verify a new supplier record before activation.',
  id: '30000000-0000-4000-8000-000000000003',
  isEnabled: false,
  name: 'Vendor onboarding',
  preventSelfApproval: true,
  processingConfig: { durationMs: 250, failuresBeforeSuccess: 0, maxAttempts: 4 },
  requestSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { supplierName: { type: 'string', title: 'Supplier name' } },
    required: ['supplierName'],
  },
  requiresApproval: true,
  revision: 1,
  stableKey: 'vendor_onboarding',
  targets: [{ config: { handler: 'demo' }, position: 0, targetKind: 'processor' }],
  updatedAt: '2026-08-29T09:30:00.000Z',
  versionId: '40000000-0000-4000-8000-000000000003',
  versionNo: 1,
  versionStatus: 'draft',
};

const completedRequest: RequestDetail['request'] = {
  attemptCount: 2,
  correlationId: SHOWCASE_IDS.correlationCompleted,
  id: SHOWCASE_IDS.expenseRequestCompleted,
  maxAttempts: 3,
  payload: {
    amount: 1250,
    costCenter: 'OPS-42',
    summary: 'Dubai client workshop travel — September 2026',
  },
  source: 'rest',
  status: 'succeeded',
  statusChangedAt: '2026-08-31T18:12:18.000Z',
  submittedAt: '2026-08-31T18:10:00.000Z',
  versionNo: 2,
  workflowId: SHOWCASE_IDS.expenseWorkflow,
  workflowName: 'Expense review',
  workflowVersionId: SHOWCASE_IDS.expenseVersion,
};

const pendingRequest: RequestDetail['request'] = {
  attemptCount: 0,
  correlationId: SHOWCASE_IDS.correlationPending,
  id: SHOWCASE_IDS.expenseRequestPending,
  maxAttempts: 3,
  payload: {
    amount: 860,
    costCenter: 'OPS-42',
    summary: 'Client workshop venue deposit',
  },
  source: 'graphql',
  status: 'pending_approval',
  statusChangedAt: '2026-08-31T19:05:00.000Z',
  submittedAt: '2026-08-31T19:04:31.000Z',
  versionNo: 2,
  workflowId: SHOWCASE_IDS.expenseWorkflow,
  workflowName: 'Expense review',
  workflowVersionId: SHOWCASE_IDS.expenseVersion,
};

function requestDetail(
  request: RequestDetail['request'],
  approval: RequestDetail['approval'],
  transitions: RequestDetail['transitions'],
): RequestDetail {
  return { approval, request, transitions };
}

const completedDetail = requestDetail(
  completedRequest,
  {
    decidedBy: 'Amina Approver',
    id: SHOWCASE_IDS.approvalCompleted,
    note: 'Approved for the client workshop.',
    requestedBy: 'Omar Operator',
    revision: 2,
    status: 'approved',
  },
  [
    {
      actorName: 'Omar Operator',
      fromStatus: null,
      id: '61000000-0000-4000-8000-000000000001',
      occurredAt: '2026-08-31T18:10:00.000Z',
      reason: 'Request and schema version locked together.',
      toStatus: 'received',
    },
    {
      actorName: 'Amina Approver',
      fromStatus: 'pending_approval',
      id: '61000000-0000-4000-8000-000000000002',
      occurredAt: '2026-08-31T18:11:00.000Z',
      reason: 'Independent approval recorded.',
      toStatus: 'approved',
    },
    {
      actorName: 'QueueForge worker',
      fromStatus: 'processing',
      id: '61000000-0000-4000-8000-000000000003',
      occurredAt: '2026-08-31T18:11:44.000Z',
      reason: 'Receiver was temporarily unavailable; retry retained.',
      toStatus: 'failed',
    },
    {
      actorName: 'QueueForge worker',
      fromStatus: 'processing',
      id: '61000000-0000-4000-8000-000000000004',
      occurredAt: '2026-08-31T18:12:18.000Z',
      reason: 'Second bounded attempt completed and receipt sealed.',
      toStatus: 'succeeded',
    },
  ],
);

const pendingDetail = requestDetail(
  pendingRequest,
  {
    decidedBy: null,
    id: SHOWCASE_IDS.approvalPending,
    note: null,
    requestedBy: 'Omar Operator',
    revision: 1,
    status: 'pending',
  },
  [
    {
      actorName: 'Omar Operator',
      fromStatus: null,
      id: '61000000-0000-4000-8000-000000000005',
      occurredAt: '2026-08-31T19:04:31.000Z',
      reason: 'Request and schema version locked together.',
      toStatus: 'received',
    },
    {
      actorName: 'QueueForge',
      fromStatus: 'received',
      id: '61000000-0000-4000-8000-000000000006',
      occurredAt: '2026-08-31T19:05:00.000Z',
      reason: 'Waiting for an independent decision.',
      toStatus: 'pending_approval',
    },
  ],
);

export interface ShowcaseState {
  approvals: ApprovalTask[];
  audit: AuditEvent[];
  deadLetters: DeadLetter[];
  deliveries: WebhookDelivery[];
  endpoints: WebhookEndpoint[];
  notifications: Notification[];
  queues: QueueSnapshot[];
  requestDetails: Map<string, RequestDetail>;
  team: TeamMember[];
  workflows: WorkflowDetail[];
}

export function createShowcaseState(): ShowcaseState {
  return {
    approvals: [
      {
        createdAt: '2026-08-31T19:05:00.000Z',
        id: SHOWCASE_IDS.approvalPending,
        payloadSummary: 'AED 860 · Client workshop venue deposit · OPS-42',
        requestId: SHOWCASE_IDS.expenseRequestPending,
        requestedById: SHOWCASE_IDS.operator,
        requestedByName: 'Omar Operator',
        revision: 1,
        status: 'pending',
        workflowName: 'Expense review',
      },
      {
        createdAt: '2026-08-31T18:10:15.000Z',
        id: SHOWCASE_IDS.approvalCompleted,
        payloadSummary: 'AED 1,250 · Dubai client workshop travel · OPS-42',
        requestId: SHOWCASE_IDS.expenseRequestCompleted,
        requestedById: SHOWCASE_IDS.operator,
        requestedByName: 'Omar Operator',
        revision: 2,
        status: 'approved',
        workflowName: 'Expense review',
      },
    ],
    audit: (
      [
        [
          'request.completed',
          'QueueForge worker',
          'Request completed after a retained retry',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:12:18.000Z',
        ],
        [
          'webhook.delivery_succeeded',
          'QueueForge worker',
          'Signed result accepted by Portfolio receiver',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:12:17.000Z',
        ],
        [
          'request.retry_scheduled',
          'QueueForge worker',
          'Temporary receiver failure retained as attempt 1',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:11:44.000Z',
        ],
        [
          'approval.decided',
          'Amina Approver',
          'Expense review approved independently',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:11:00.000Z',
        ],
        [
          'approval.requested',
          'Omar Operator',
          'Expense review sent for approval',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:10:15.000Z',
        ],
        [
          'request.received',
          'Omar Operator',
          'Expense review submitted with version 2',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:10:00.000Z',
        ],
        [
          'approval.requested',
          'Omar Operator',
          'Venue deposit sent for approval',
          SHOWCASE_IDS.expenseRequestPending,
          '2026-08-31T19:05:00.000Z',
        ],
        [
          'request.received',
          'Omar Operator',
          'Venue deposit request received',
          SHOWCASE_IDS.expenseRequestPending,
          '2026-08-31T19:04:31.000Z',
        ],
      ] satisfies ReadonlyArray<readonly [string, string, string, string, string]>
    ).map(([eventType, actorName, summary, resourceId, occurredAt], index) => ({
      actorName,
      correlationId:
        resourceId === SHOWCASE_IDS.expenseRequestPending
          ? SHOWCASE_IDS.correlationPending
          : SHOWCASE_IDS.correlationCompleted,
      eventType,
      id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      occurredAt,
      resourceId,
      resourceType: 'request',
      summary,
    })),
    deadLetters: [
      {
        attemptCount: 3,
        deadLetteredAt: '2026-08-30T11:15:00.000Z',
        id: 'b0000000-0000-4000-8000-000000000001',
        reason: 'Synthetic supplier registry remained unavailable after bounded attempts.',
        requestId: '60000000-0000-4000-8000-000000000006',
        workflowName: 'Vendor onboarding',
      },
    ],
    deliveries: [
      {
        attemptCount: 2,
        endpointName: 'Portfolio receiver',
        eventId: '80000000-0000-4000-8000-000000000011',
        eventType: 'request.completed',
        id: '80000000-0000-4000-8000-000000000001',
        lastStatusCode: 202,
        nextAttemptAt: null,
        requestId: SHOWCASE_IDS.expenseRequestCompleted,
        status: 'delivered',
        updatedAt: '2026-08-31T18:12:17.000Z',
        workflowName: 'Expense review',
      },
      {
        attemptCount: 1,
        endpointName: 'Portfolio receiver',
        eventId: '80000000-0000-4000-8000-000000000012',
        eventType: 'request.processing',
        id: '80000000-0000-4000-8000-000000000002',
        lastStatusCode: 503,
        nextAttemptAt: '2026-08-31T19:06:00.000Z',
        requestId: SHOWCASE_IDS.expenseRequestPending,
        status: 'retry',
        updatedAt: '2026-08-31T19:05:30.000Z',
        workflowName: 'Expense review',
      },
    ],
    endpoints: [
      {
        active: true,
        id: SHOWCASE_IDS.endpoint,
        keyId: 'portfolio-v1',
        name: 'Portfolio receiver',
        updatedAt: '2026-08-31T17:45:00.000Z',
        url: 'https://receiver.queueforge.test/events',
      },
    ],
    notifications: (
      [
        [
          'Request completed',
          'Expense review completed after two bounded attempts.',
          'success',
          SHOWCASE_IDS.expenseRequestCompleted,
          null,
          '2026-08-31T18:12:18.000Z',
        ],
        [
          'Approval needed',
          'Client workshop venue deposit is waiting for Amina.',
          'warning',
          SHOWCASE_IDS.expenseRequestPending,
          null,
          '2026-08-31T19:05:00.000Z',
        ],
        [
          'Receipt sealed',
          'The signed delivery receipt is available for inspection.',
          'success',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:20:00.000Z',
          '2026-08-31T18:12:17.000Z',
        ],
        [
          'Retry retained',
          'Attempt 1 remains visible; attempt 2 succeeded.',
          'info',
          SHOWCASE_IDS.expenseRequestCompleted,
          '2026-08-31T18:20:00.000Z',
          '2026-08-31T18:11:44.000Z',
        ],
      ] satisfies ReadonlyArray<
        readonly [string, string, Notification['kind'], string, string | null, string]
      >
    ).map(([title, body, kind, requestId, readAt, createdAt], index) => ({
      body,
      createdAt,
      id: `c0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      kind,
      readAt,
      requestId,
      title,
      workflowName: 'Expense review',
    })),
    queues: [
      {
        active: 0,
        delayed: 0,
        failed: 0,
        heartbeatAt: '2026-08-31T19:05:45.000Z',
        name: 'workflow-requests',
        outboxBacklog: 0,
        outboxDead: 0,
        paused: false,
        telemetryAvailable: true,
        waiting: 1,
        workerCount: 1,
        workerState: 'running',
      },
      {
        active: 0,
        delayed: 1,
        failed: 0,
        heartbeatAt: '2026-08-31T19:05:45.000Z',
        name: 'webhook-delivery',
        outboxBacklog: 1,
        outboxDead: 0,
        paused: false,
        telemetryAvailable: true,
        waiting: 0,
        workerCount: 1,
        workerState: 'running',
      },
      {
        active: 0,
        delayed: 0,
        failed: 0,
        heartbeatAt: '2026-08-31T19:05:45.000Z',
        name: 'notifications',
        outboxBacklog: 0,
        outboxDead: 0,
        paused: false,
        telemetryAvailable: true,
        waiting: 0,
        workerCount: 1,
        workerState: 'running',
      },
    ],
    requestDetails: new Map([
      [completedRequest.id, completedDetail],
      [pendingRequest.id, pendingDetail],
    ]),
    team: (
      [
        ['QueueForge Admin', 'admin@queueforge.test', 'tenant_admin', true],
        ['Amina Approver', 'amina.approver@queueforge.test', 'approver', true],
        ['Omar Operator', 'omar.operator@queueforge.test', 'operator', true],
        ['Riley Viewer', 'viewer@queueforge.test', 'viewer', false],
      ] satisfies ReadonlyArray<readonly [string, string, TeamMember['role'], boolean]>
    ).map(([displayName, email, role, roleLocked], index) => ({
      displayName,
      email,
      id: `d0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      joinedAt: `2026-08-${String(20 + index).padStart(2, '0')}T09:00:00.000Z`,
      role,
      roleLocked,
      status: 'active',
    })),
    workflows: [expenseWorkflow, accessWorkflow, vendorWorkflow],
  };
}

export function workflowSummaries(state: ShowcaseState): WorkflowSummary[] {
  return state.workflows.map((workflow) => ({
    description: workflow.description,
    id: workflow.id,
    isEnabled: workflow.isEnabled,
    name: workflow.name,
    requiresApproval: workflow.requiresApproval,
    revision: workflow.revision,
    stableKey: workflow.stableKey,
    updatedAt: workflow.updatedAt,
    versionId: workflow.versionId,
    versionNo: workflow.versionNo,
    versionStatus: workflow.versionStatus,
  }));
}

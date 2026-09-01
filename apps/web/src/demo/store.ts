import type { WorkflowRequestView, WorkflowSummary } from '@queueforge/contracts';

import type {
  ApprovalTask,
  AuditEvent,
  DashboardOverview,
  DeadLetter,
  Notification,
  RequestDetail,
  TeamMember,
  WebhookDelivery,
  WebhookEndpoint,
  WorkflowDetail,
} from '../domain/models';
import {
  createShowcaseState,
  SHOWCASE_IDS,
  workflowSummaries,
  type ShowcaseState,
} from './fixtures';

let state: ShowcaseState | null = null;

export function showcaseState(): ShowcaseState {
  state ??= createShowcaseState();
  return state;
}

export function resetShowcaseState(): void {
  state = createShowcaseState();
}

export function showcaseDashboard(): DashboardOverview {
  const current = showcaseState();
  const requests = Array.from(current.requestDetails.values()).map((detail) => detail.request);
  const statusCounts = Array.from(
    requests.reduce<Map<WorkflowRequestView['status'], number>>((counts, request) => {
      counts.set(request.status, (counts.get(request.status) ?? 0) + 1);
      return counts;
    }, new Map()),
  ).map(([status, count]) => ({ count, status }));
  return {
    queues: current.queues.map(({ active, delayed, failed, name, waiting }) => ({
      active,
      delayed,
      failed,
      name,
      waiting,
    })),
    recentRequests: requests
      .toSorted((left, right) => right.submittedAt.localeCompare(left.submittedAt))
      .slice(0, 8),
    statusCounts,
    throughput: [
      ['2026-08-25T00:00:00.000Z', 8, 1],
      ['2026-08-26T00:00:00.000Z', 11, 0],
      ['2026-08-27T00:00:00.000Z', 9, 1],
      ['2026-08-28T00:00:00.000Z', 14, 0],
      ['2026-08-29T00:00:00.000Z', 12, 1],
      ['2026-08-30T00:00:00.000Z', 15, 1],
      ['2026-08-31T00:00:00.000Z', 18, 0],
    ].map(([bucket, succeeded, failed]) => ({
      bucket: String(bucket),
      failed: Number(failed),
      succeeded: Number(succeeded),
    })),
  };
}

export function showcaseRequestDetail(id: string): RequestDetail {
  const detail = showcaseState().requestDetails.get(id);
  if (detail === undefined) throw new Error('Request not found in this showcase scenario.');
  return detail;
}

export function listShowcaseRequests(): WorkflowRequestView[] {
  return Array.from(showcaseState().requestDetails.values()).map((detail) => detail.request);
}

export function listShowcaseWorkflows(): WorkflowSummary[] {
  return workflowSummaries(showcaseState());
}

function recordAudit(input: {
  readonly actorName: string;
  readonly correlationId: string;
  readonly eventType: string;
  readonly resourceId: string;
  readonly summary: string;
}): AuditEvent {
  const event: AuditEvent = {
    actorName: input.actorName,
    correlationId: input.correlationId,
    eventType: input.eventType,
    id: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    resourceId: input.resourceId,
    resourceType: 'request',
    summary: input.summary,
  };
  showcaseState().audit.unshift(event);
  return event;
}

function addNotification(input: {
  readonly body: string;
  readonly kind: Notification['kind'];
  readonly requestId: string;
  readonly title: string;
  readonly workflowName: string;
}): Notification {
  const notification: Notification = {
    body: input.body,
    createdAt: new Date().toISOString(),
    id: crypto.randomUUID(),
    kind: input.kind,
    readAt: null,
    requestId: input.requestId,
    title: input.title,
    workflowName: input.workflowName,
  };
  showcaseState().notifications.unshift(notification);
  return notification;
}

export function submitShowcaseRequest(input: {
  readonly payload: Record<string, unknown>;
  readonly workflowKey: string;
}): WorkflowRequestView {
  const current = showcaseState();
  const workflow = current.workflows.find((candidate) => candidate.stableKey === input.workflowKey);
  if (workflow === undefined) throw new Error('Choose a request type from the showcase catalog.');
  const now = new Date().toISOString();
  const request: WorkflowRequestView = {
    attemptCount: 0,
    correlationId: crypto.randomUUID(),
    id: crypto.randomUUID(),
    maxAttempts:
      typeof workflow.processingConfig['maxAttempts'] === 'number'
        ? workflow.processingConfig['maxAttempts']
        : 3,
    payload: input.payload,
    source: 'rest',
    status: workflow.requiresApproval ? 'pending_approval' : 'queued',
    statusChangedAt: now,
    submittedAt: now,
    versionNo: workflow.versionNo,
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersionId: workflow.versionId,
  };
  const approvalId = workflow.requiresApproval ? crypto.randomUUID() : null;
  const detail: RequestDetail = {
    approval:
      approvalId === null
        ? null
        : {
            decidedBy: null,
            id: approvalId,
            note: null,
            requestedBy: 'Omar Operator',
            revision: 1,
            status: 'pending',
          },
    request,
    transitions: [
      {
        actorName: 'Omar Operator',
        fromStatus: null,
        id: crypto.randomUUID(),
        occurredAt: now,
        reason: 'Synthetic request and request-type version locked together.',
        toStatus: 'received',
      },
      ...(workflow.requiresApproval
        ? [
            {
              actorName: 'QueueForge',
              fromStatus: 'received' as const,
              id: crypto.randomUUID(),
              occurredAt: now,
              reason: 'Waiting for an independent synthetic decision.',
              toStatus: 'pending_approval' as const,
            },
          ]
        : []),
    ],
  };
  current.requestDetails.set(request.id, detail);
  if (approvalId !== null) {
    current.approvals.unshift({
      createdAt: now,
      id: approvalId,
      payloadSummary: Object.values(input.payload).map(String).join(' · '),
      requestId: request.id,
      requestedById: SHOWCASE_IDS.operator,
      requestedByName: 'Omar Operator',
      revision: 1,
      status: 'pending',
      workflowName: workflow.name,
    });
  }
  recordAudit({
    actorName: 'Omar Operator',
    correlationId: request.correlationId,
    eventType: 'request.received',
    resourceId: request.id,
    summary: `${workflow.name} submitted in the browser-only showcase`,
  });
  addNotification({
    body: workflow.requiresApproval
      ? 'The request is waiting for an independent decision.'
      : 'The request is ready for simulated processing.',
    kind: 'info',
    requestId: request.id,
    title: 'Request accepted',
    workflowName: workflow.name,
  });
  return request;
}

export function decideShowcaseApproval(
  approvalId: string,
  input: { readonly decision: 'approved' | 'rejected'; readonly note?: string },
): void {
  const current = showcaseState();
  const approval = current.approvals.find((candidate) => candidate.id === approvalId);
  if (approval === undefined) throw new Error('Approval not found in this showcase scenario.');
  approval.status = input.decision;
  approval.revision += 1;
  const detail = showcaseRequestDetail(approval.requestId);
  const now = new Date().toISOString();
  if (detail.approval !== null) {
    detail.approval.status = input.decision;
    detail.approval.decidedBy = 'Amina Approver';
    detail.approval.note = input.note ?? null;
    detail.approval.revision += 1;
  }
  detail.request.status = input.decision === 'approved' ? 'succeeded' : 'rejected';
  detail.request.statusChangedAt = now;
  detail.request.attemptCount = input.decision === 'approved' ? 2 : 0;
  detail.transitions.push({
    actorName: 'Amina Approver',
    fromStatus: 'pending_approval',
    id: crypto.randomUUID(),
    occurredAt: now,
    reason: input.note ?? 'Independent synthetic decision recorded.',
    toStatus: input.decision,
  });
  if (input.decision === 'approved') {
    detail.transitions.push(
      {
        actorName: 'QueueForge worker',
        fromStatus: 'processing',
        id: crypto.randomUUID(),
        occurredAt: now,
        reason: 'Attempt 1 retained a temporary receiver failure.',
        toStatus: 'failed',
      },
      {
        actorName: 'QueueForge worker',
        fromStatus: 'processing',
        id: crypto.randomUUID(),
        occurredAt: now,
        reason: 'Attempt 2 completed and sealed the synthetic receipt.',
        toStatus: 'succeeded',
      },
    );
    current.deliveries.unshift({
      attemptCount: 2,
      endpointName: 'Portfolio receiver',
      eventId: crypto.randomUUID(),
      eventType: 'request.completed',
      id: crypto.randomUUID(),
      lastStatusCode: 202,
      nextAttemptAt: null,
      requestId: detail.request.id,
      status: 'delivered',
      updatedAt: now,
      workflowName: detail.request.workflowName,
    });
  }
  recordAudit({
    actorName: 'Amina Approver',
    correlationId: detail.request.correlationId,
    eventType: 'approval.decided',
    resourceId: detail.request.id,
    summary: `${detail.request.workflowName} ${input.decision} in the browser-only showcase`,
  });
  addNotification({
    body:
      input.decision === 'approved'
        ? 'The synthetic request completed after a retained retry.'
        : 'The synthetic request stopped at its decision gate.',
    kind: input.decision === 'approved' ? 'success' : 'warning',
    requestId: detail.request.id,
    title: input.decision === 'approved' ? 'Request completed' : 'Request declined',
    workflowName: detail.request.workflowName,
  });
}

export function updateShowcaseRequest(
  id: string,
  command: 'cancel' | 'retry',
): WorkflowRequestView {
  const detail = showcaseRequestDetail(id);
  detail.request.status = command === 'cancel' ? 'cancelled' : 'queued';
  detail.request.statusChangedAt = new Date().toISOString();
  if (command === 'retry') detail.request.attemptCount += 1;
  return detail.request;
}

export function createShowcaseWorkflow(input: {
  readonly description?: string;
  readonly name: string;
  readonly stableKey: string;
}): WorkflowDetail {
  const workflow: WorkflowDetail = {
    description: input.description ?? null,
    id: crypto.randomUUID(),
    isEnabled: false,
    name: input.name,
    preventSelfApproval: true,
    processingConfig: { durationMs: 250, failuresBeforeSuccess: 0, maxAttempts: 3 },
    requestSchema: { type: 'object', additionalProperties: false, properties: {} },
    requiresApproval: true,
    revision: 1,
    stableKey: input.stableKey,
    targets: [{ config: { handler: 'demo' }, position: 0, targetKind: 'processor' }],
    updatedAt: new Date().toISOString(),
    versionId: crypto.randomUUID(),
    versionNo: 1,
    versionStatus: 'draft',
  };
  showcaseState().workflows.unshift(workflow);
  return workflow;
}

export function updateShowcaseWorkflow(
  workflowId: string,
  body: Record<string, unknown>,
): WorkflowDetail {
  const workflow = showcaseState().workflows.find((candidate) => candidate.id === workflowId);
  if (workflow === undefined) throw new Error('Request type not found in this showcase scenario.');
  Object.assign(workflow, body, {
    revision: workflow.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return workflow;
}

export function activateShowcaseWorkflow(workflowId: string): WorkflowDetail {
  return updateShowcaseWorkflow(workflowId, { isEnabled: true, versionStatus: 'active' });
}

export function cloneShowcaseWorkflow(workflowId: string): WorkflowDetail {
  const workflow = showcaseState().workflows.find((candidate) => candidate.id === workflowId);
  if (workflow === undefined) throw new Error('Request type not found in this showcase scenario.');
  const clone: WorkflowDetail = {
    ...structuredClone(workflow),
    revision: 1,
    updatedAt: new Date().toISOString(),
    versionId: crypto.randomUUID(),
    versionNo: workflow.versionNo + 1,
    versionStatus: 'draft',
  };
  showcaseState().workflows.unshift(clone);
  return clone;
}

export function addShowcaseEndpoint(input: {
  readonly keyId: string;
  readonly name: string;
  readonly url: string;
}): WebhookEndpoint {
  const endpoint: WebhookEndpoint = {
    active: true,
    id: crypto.randomUUID(),
    keyId: input.keyId,
    name: input.name,
    updatedAt: new Date().toISOString(),
    url: input.url,
  };
  showcaseState().endpoints.unshift(endpoint);
  return endpoint;
}

export function replayShowcaseDelivery(deliveryId: string): void {
  const delivery = showcaseState().deliveries.find((candidate) => candidate.id === deliveryId);
  if (delivery === undefined) throw new Error('Delivery not found in this showcase scenario.');
  delivery.attemptCount += 1;
  delivery.status = 'delivered';
  delivery.lastStatusCode = 202;
  delivery.nextAttemptAt = null;
  delivery.updatedAt = new Date().toISOString();
}

export function retryShowcaseDeadLetter(deadLetterId: string): void {
  const current = showcaseState();
  current.deadLetters = current.deadLetters.filter((item) => item.id !== deadLetterId);
  const queue = current.queues.find((item) => item.name === 'workflow-requests');
  if (queue !== undefined) queue.waiting += 1;
}

export function markShowcaseNotificationRead(notificationId: string): Notification {
  const notification = showcaseState().notifications.find((item) => item.id === notificationId);
  if (notification === undefined) throw new Error('Notification not found in this showcase.');
  notification.readAt = new Date().toISOString();
  return notification;
}

export function addShowcaseTeamMember(input: {
  readonly displayName: string;
  readonly email: string;
  readonly role: TeamMember['role'];
}): TeamMember {
  const member: TeamMember = {
    displayName: input.displayName,
    email: input.email,
    id: crypto.randomUUID(),
    joinedAt: new Date().toISOString(),
    role: input.role,
    roleLocked: false,
    status: 'invited',
  };
  showcaseState().team.unshift(member);
  return member;
}

export function updateShowcaseTeamRole(memberId: string, role: TeamMember['role']): TeamMember {
  const member = showcaseState().team.find((item) => item.id === memberId);
  if (member === undefined) throw new Error('Team member not found in this showcase.');
  member.role = role;
  return member;
}

export type ShowcaseCollection =
  ApprovalTask | AuditEvent | DeadLetter | Notification | TeamMember | WebhookDelivery;

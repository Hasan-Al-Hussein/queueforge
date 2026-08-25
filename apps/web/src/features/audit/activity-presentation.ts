import type { AuditEvent } from '../../domain/models';

interface ActivityDefinition {
  readonly action: string;
  readonly category: string;
}

export interface ActivityPresentation extends ActivityDefinition {
  readonly resource: string;
  readonly summary: string;
}

const ACTIVITY_DEFINITIONS: Readonly<Record<string, ActivityDefinition>> = {
  'api_client.created': { action: 'API access key created', category: 'Access' },
  'api_client.revoked': { action: 'API access key revoked', category: 'Access' },
  'approval.approved': { action: 'Approval granted', category: 'Approvals' },
  'approval.rejected': { action: 'Approval declined', category: 'Approvals' },
  'auth.csrf_failed': { action: 'Unsafe request blocked', category: 'Security' },
  'auth.login_failed': { action: 'Sign-in failed', category: 'Security' },
  'auth.login_succeeded': { action: 'Signed in', category: 'Security' },
  'auth.logout': { action: 'Signed out', category: 'Security' },
  'auth.refresh_failed': { action: 'Session renewal failed', category: 'Security' },
  'auth.refresh_reuse_detected': {
    action: 'Reused session token blocked',
    category: 'Security',
  },
  'auth.refresh_rotated': { action: 'Session renewed', category: 'Security' },
  'auth.tenant_selected': { action: 'Workspace changed', category: 'Security' },
  'dead_letter.requeued': { action: 'Item queued again', category: 'Processing' },
  'membership.created': { action: 'Team member added', category: 'Team' },
  'membership.role_changed': { action: 'Team role changed', category: 'Team' },
  'notification.requested': { action: 'Notification scheduled', category: 'Notifications' },
  'request.approved': { action: 'Request approved', category: 'Requests' },
  'request.cancelled': { action: 'Request cancelled', category: 'Requests' },
  'request.dead_lettered': { action: 'Request needs help', category: 'Processing' },
  'request.failed': { action: 'Processing attempt failed', category: 'Processing' },
  'request.pending_approval': { action: 'Request sent for approval', category: 'Requests' },
  'request.queued': { action: 'Request queued', category: 'Requests' },
  'request.rejected': { action: 'Request rejected', category: 'Requests' },
  'request.requeued': { action: 'Request queued again', category: 'Processing' },
  'request.retry_scheduled': { action: 'Request retry scheduled', category: 'Processing' },
  'request.succeeded': { action: 'Request completed', category: 'Requests' },
  'tenant.created': { action: 'Workspace created', category: 'Workspace' },
  'webhook.delivery.dead_lettered': {
    action: 'Result delivery needs help',
    category: 'Integrations',
  },
  'webhook.delivery.delivered': { action: 'Result delivered', category: 'Integrations' },
  'webhook.delivery.retry_scheduled': {
    action: 'Result delivery retry scheduled',
    category: 'Integrations',
  },
  'webhook.delivery_replayed': { action: 'Result delivery tried again', category: 'Integrations' },
  'webhook.endpoint_created': { action: 'Integration added', category: 'Integrations' },
  'webhook.endpoint_disabled': { action: 'Integration disabled', category: 'Integrations' },
  'webhook.endpoint_updated': { action: 'Integration updated', category: 'Integrations' },
  'workflow.activated': { action: 'Request type activated', category: 'Request types' },
  'workflow.created': { action: 'Request type created', category: 'Request types' },
  'workflow.draft_saved': { action: 'Request type draft saved', category: 'Request types' },
};

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  api_client: 'API access key',
  approval_task: 'approval',
  auth_session: 'session',
  dead_letter: 'recovery item',
  membership: 'team member',
  notification: 'notification',
  tenant: 'workspace',
  webhook_delivery: 'result delivery',
  webhook_endpoint: 'integration',
  workflow_request: 'request',
  workflow_template: 'request type',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  approver: 'Approver',
  operator: 'Operator',
  platform_admin: 'Platform admin',
  tenant_admin: 'Workspace admin',
  viewer: 'Viewer',
};

function sentenceFromCode(value: string): string {
  const words = value.replaceAll(/[._-]+/gu, ' ').trim();
  if (words === '') return 'System activity';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function parseSummary(summary: string): Readonly<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(summary);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : null;
  } catch {
    return null;
  }
}

function positiveInteger(metadata: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function stringValue(metadata: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function plural(count: number, singular: string, pluralValue = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : pluralValue}`;
}

function describeMetadata(eventType: string, summary: string): string {
  const metadata = parseSummary(summary);
  if (metadata === null) return 'QueueForge recorded this activity.';
  const attemptNo = positiveInteger(metadata, 'attemptNo');
  const responseStatus = positiveInteger(metadata, 'responseStatus');
  const notifications = positiveInteger(metadata, 'notifications');
  const deliveries = positiveInteger(metadata, 'webhookDeliveries');
  const role = stringValue(metadata, 'role');
  const source = stringValue(metadata, 'source');

  switch (eventType) {
    case 'request.succeeded': {
      const parts = [attemptNo === null ? null : `Finished on attempt ${String(attemptNo)}`];
      if (notifications !== null) parts.push(`${plural(notifications, 'notification')} created`);
      if (deliveries !== null)
        parts.push(`${plural(deliveries, 'result delivery', 'result deliveries')} created`);
      const visibleParts = parts.filter((part): part is string => part !== null);
      return visibleParts.length === 0
        ? 'The request finished successfully.'
        : `${visibleParts.join('. ')}.`;
    }
    case 'request.dead_lettered':
      return attemptNo === null
        ? 'All automatic processing attempts were used.'
        : `Processing stopped after attempt ${String(attemptNo)} and now needs attention.`;
    case 'request.retry_scheduled':
      return attemptNo === null
        ? 'QueueForge will try this request again automatically.'
        : `Attempt ${String(attemptNo)} failed. QueueForge scheduled another try.`;
    case 'request.pending_approval':
      return source === null
        ? 'This request is waiting for a decision.'
        : `Received through ${sentenceFromCode(source).toLowerCase()} and is waiting for a decision.`;
    case 'request.queued':
      return 'Accepted and waiting to be processed.';
    case 'request.cancelled':
      return 'Processing was stopped by an authorized user.';
    case 'request.approved':
      return 'The request passed its approval step and can continue.';
    case 'request.rejected':
      return 'The request was declined and will not continue.';
    case 'request.failed':
      return 'A processing attempt failed. QueueForge will follow the configured retry policy.';
    case 'request.requeued':
    case 'dead_letter.requeued':
      return 'An authorized user returned this item to processing without deleting its history.';
    case 'approval.approved':
      return 'An approver accepted the request.';
    case 'approval.rejected':
      return 'An approver declined the request.';
    case 'webhook.delivery.delivered':
      return `${attemptNo === null ? 'The result reached the receiving system' : `Delivered on attempt ${String(attemptNo)}`}${responseStatus === null ? '' : `; the receiver replied with HTTP ${String(responseStatus)}`}.`;
    case 'webhook.delivery.retry_scheduled':
      return attemptNo === null
        ? 'The receiving system did not accept the result. Another try is scheduled.'
        : `Attempt ${String(attemptNo)} did not complete. Another delivery try is scheduled.`;
    case 'webhook.delivery.dead_lettered':
      return 'The result could not be delivered after every automatic try.';
    case 'webhook.delivery_replayed':
      return 'An authorized user asked QueueForge to try this delivery again.';
    case 'membership.role_changed':
      return role === null
        ? 'A team member’s access level was changed.'
        : `Access changed to ${ROLE_LABELS[role] ?? sentenceFromCode(role)}.`;
    case 'membership.created':
      return role === null
        ? 'A person was added to this workspace.'
        : `Added with the ${ROLE_LABELS[role] ?? sentenceFromCode(role)} role.`;
    case 'workflow.draft_saved': {
      const targetCount = positiveInteger(metadata, 'targetCount');
      return targetCount === null
        ? 'Draft changes were saved.'
        : `Draft saved with ${plural(targetCount, 'delivery action')}.`;
    }
    case 'workflow.created':
      return 'A new request type was saved as a draft.';
    case 'workflow.activated':
      return 'The latest version is available for new requests.';
    case 'webhook.endpoint_created':
      return 'A new destination was configured for completed results.';
    case 'webhook.endpoint_disabled':
      return 'QueueForge will no longer send results to this destination.';
    case 'webhook.endpoint_updated':
      return 'The destination settings were changed.';
    case 'notification.requested':
      return 'QueueForge queued an update for its intended recipient.';
    case 'tenant.created':
      return 'A new workspace was created.';
    case 'api_client.created':
      return 'A new key was created for a connected application.';
    case 'api_client.revoked':
      return 'A connected application can no longer use this key.';
    case 'auth.login_succeeded':
      return 'The user completed sign-in successfully.';
    case 'auth.login_failed':
      return 'A sign-in attempt was refused.';
    case 'auth.logout':
      return 'The user ended their signed-in session.';
    case 'auth.refresh_rotated':
      return 'The signed-in session was renewed securely.';
    case 'auth.tenant_selected':
      return 'The user changed to another workspace.';
    case 'auth.refresh_reuse_detected':
      return 'QueueForge revoked the session after detecting a reused refresh token.';
    case 'auth.csrf_failed':
      return 'QueueForge blocked a request that failed its browser safety check.';
    default:
      return 'QueueForge recorded this activity.';
  }
}

export function activityPresentation(
  event: Pick<AuditEvent, 'eventType' | 'resourceType' | 'summary'>,
): ActivityPresentation {
  const definition = ACTIVITY_DEFINITIONS[event.eventType] ?? {
    action: sentenceFromCode(event.eventType),
    category: 'Other',
  };
  return {
    ...definition,
    resource: RESOURCE_LABELS[event.resourceType] ?? sentenceFromCode(event.resourceType),
    summary: describeMetadata(event.eventType, event.summary),
  };
}

export function formattedTechnicalSummary(summary: string): string {
  const parsed = parseSummary(summary);
  return parsed === null ? summary : JSON.stringify(parsed, null, 2);
}

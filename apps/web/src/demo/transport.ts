import type { ApiRequestOptions } from '../api/client';
import {
  activateShowcaseWorkflow,
  addShowcaseEndpoint,
  addShowcaseTeamMember,
  cloneShowcaseWorkflow,
  createShowcaseWorkflow,
  decideShowcaseApproval,
  listShowcaseRequests,
  listShowcaseWorkflows,
  markShowcaseNotificationRead,
  replayShowcaseDelivery,
  retryShowcaseDeadLetter,
  showcaseDashboard,
  showcaseRequestDetail,
  showcaseState,
  submitShowcaseRequest,
  updateShowcaseRequest,
  updateShowcaseTeamRole,
  updateShowcaseWorkflow,
} from './store';

const SHOWCASE_ORIGIN = 'https://showcase.queueforge.test';

function objectBody(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string, fallback = ''): string {
  const value = body[key];
  return typeof value === 'string' ? value : fallback;
}

function pagination(url: URL): { readonly page: number; readonly pageSize: number } {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 10)));
  return {
    page: Number.isFinite(page) ? Math.trunc(page) : 1,
    pageSize: Number.isFinite(pageSize) ? Math.trunc(pageSize) : 10,
  };
}

function paged<T>(
  items: readonly T[],
  url: URL,
): {
  readonly items: T[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly totalItems: number;
    readonly totalPages: number;
  };
} {
  const { page, pageSize } = pagination(url);
  const totalItems = items.length;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;
  return {
    items: items.slice(offset, offset + pageSize),
    meta: { page, pageSize, totalItems, totalPages },
  };
}

function routeId(pathname: string, prefix: string, suffix = ''): string | null {
  if (!pathname.startsWith(prefix) || (suffix !== '' && !pathname.endsWith(suffix))) return null;
  const end = suffix === '' ? pathname.length : pathname.length - suffix.length;
  const candidate = pathname.slice(prefix.length, end);
  return candidate === '' || candidate.includes('/') ? null : decodeURIComponent(candidate);
}

export async function showcaseApiResponse<T>(
  path: string,
  options: ApiRequestOptions<T>,
): Promise<unknown> {
  await Promise.resolve();
  if (options.signal?.aborted === true) throw new DOMException('Aborted', 'AbortError');

  const url = new URL(path, SHOWCASE_ORIGIN);
  const method = options.method ?? 'GET';
  const body = objectBody(options.body);
  const current = showcaseState();

  if (method === 'GET' && url.pathname === '/api/v1/dashboard/overview') {
    return showcaseDashboard();
  }

  if (url.pathname === '/api/v1/requests') {
    if (method === 'POST') {
      return submitShowcaseRequest({
        payload: objectBody(body['payload']),
        workflowKey: stringField(body, 'workflowKey'),
      });
    }
    const status = url.searchParams.get('status');
    const search = (url.searchParams.get('search') ?? '').toLowerCase();
    const sortDirection = url.searchParams.get('sortDirection') === 'asc' ? 1 : -1;
    const requests = listShowcaseRequests()
      .filter((request) => status === null || request.status === status)
      .filter((request) => {
        if (search === '') return true;
        return `${request.workflowName} ${Object.values(request.payload).join(' ')} ${request.status}`
          .toLowerCase()
          .includes(search);
      })
      .toSorted((left, right) => sortDirection * left.submittedAt.localeCompare(right.submittedAt));
    return paged(requests, url);
  }

  const cancelRequestId = routeId(url.pathname, '/api/v1/requests/', '/cancel');
  if (method === 'POST' && cancelRequestId !== null) {
    return updateShowcaseRequest(cancelRequestId, 'cancel');
  }
  const retryRequestId = routeId(url.pathname, '/api/v1/requests/', '/retry');
  if (method === 'POST' && retryRequestId !== null) {
    return updateShowcaseRequest(retryRequestId, 'retry');
  }
  const requestId = routeId(url.pathname, '/api/v1/requests/');
  if (method === 'GET' && requestId !== null) return showcaseRequestDetail(requestId).request;

  if (url.pathname === '/api/v1/approvals' && method === 'GET') {
    return paged(
      current.approvals.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt)),
      url,
    );
  }
  const approvalId = routeId(url.pathname, '/api/v1/approvals/', '/decide');
  if (method === 'POST' && approvalId !== null) {
    const decision = body['decision'];
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new Error('Choose approve or decline for this simulated decision.');
    }
    decideShowcaseApproval(approvalId, {
      decision,
      note: typeof body['note'] === 'string' ? body['note'] : undefined,
    });
    return { simulated: true };
  }

  if (url.pathname === '/api/v1/workflows') {
    if (method === 'POST') {
      return createShowcaseWorkflow({
        description: stringField(body, 'description'),
        name: stringField(body, 'name', 'Untitled request type'),
        stableKey: stringField(body, 'stableKey', `showcase_${Date.now()}`),
      });
    }
    return listShowcaseWorkflows();
  }
  const workflowDraftId = routeId(url.pathname, '/api/v1/workflows/', '/draft');
  if (method === 'PATCH' && workflowDraftId !== null) {
    return updateShowcaseWorkflow(workflowDraftId, body);
  }
  const workflowActivateId = routeId(url.pathname, '/api/v1/workflows/', '/activate');
  if (method === 'POST' && workflowActivateId !== null) {
    return activateShowcaseWorkflow(workflowActivateId);
  }
  const workflowCloneId = routeId(url.pathname, '/api/v1/workflows/', '/clone-draft');
  if (method === 'POST' && workflowCloneId !== null) {
    return cloneShowcaseWorkflow(workflowCloneId);
  }
  const workflowId = routeId(url.pathname, '/api/v1/workflows/');
  if (method === 'GET' && workflowId !== null) {
    const workflow = current.workflows.find((candidate) => candidate.id === workflowId);
    if (workflow === undefined) throw new Error('Request type not found in this showcase.');
    return workflow;
  }

  if (url.pathname === '/api/v1/webhooks/endpoints') {
    if (method === 'POST') {
      const endpoint = addShowcaseEndpoint({
        keyId: stringField(body, 'keyId', 'portfolio-v1'),
        name: stringField(body, 'name', 'Synthetic receiver'),
        url: stringField(body, 'url', 'https://receiver.queueforge.test/events'),
      });
      return { endpoint, replayed: false, signingSecret: null };
    }
    return current.endpoints;
  }
  if (url.pathname === '/api/v1/webhooks/deliveries' && method === 'GET') {
    return paged(
      current.deliveries.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      url,
    );
  }
  const deliveryId = routeId(url.pathname, '/api/v1/webhooks/deliveries/', '/replay');
  if (method === 'POST' && deliveryId !== null) {
    replayShowcaseDelivery(deliveryId);
    return { simulated: true };
  }

  if (url.pathname === '/api/v1/operations/queues' && method === 'GET') return current.queues;
  if (url.pathname === '/api/v1/operations/dead-letters' && method === 'GET') {
    return paged(current.deadLetters, url);
  }
  const deadLetterId = routeId(url.pathname, '/api/v1/operations/dead-letters/', '/retry');
  if (method === 'POST' && deadLetterId !== null) {
    retryShowcaseDeadLetter(deadLetterId);
    return { simulated: true };
  }

  if (url.pathname === '/api/v1/notifications' && method === 'GET') {
    return paged(
      current.notifications.toSorted((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
      url,
    );
  }
  const notificationId = routeId(url.pathname, '/api/v1/notifications/');
  if (method === 'PATCH' && notificationId !== null) {
    return markShowcaseNotificationRead(notificationId);
  }

  if (url.pathname === '/api/v1/audit' && method === 'GET') {
    const eventType = url.searchParams.get('eventType');
    const events = current.audit
      .filter((event) => eventType === null || event.eventType.startsWith(eventType))
      .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    return paged(events, url);
  }

  if (url.pathname === '/api/v1/team/memberships') {
    if (method === 'POST') {
      return addShowcaseTeamMember({
        displayName: stringField(body, 'displayName', 'Synthetic teammate'),
        email: stringField(body, 'email', 'teammate@queueforge.test'),
        role:
          body['role'] === 'tenant_admin' ||
          body['role'] === 'approver' ||
          body['role'] === 'operator'
            ? body['role']
            : 'viewer',
      });
    }
    return paged(current.team, url);
  }
  const memberId = routeId(url.pathname, '/api/v1/team/memberships/');
  if (method === 'PATCH' && memberId !== null) {
    const role = body['role'];
    if (
      role !== 'tenant_admin' &&
      role !== 'approver' &&
      role !== 'operator' &&
      role !== 'viewer'
    ) {
      throw new Error('Choose a valid showcase role.');
    }
    return updateShowcaseTeamRole(memberId, role);
  }

  throw new Error(`This action is not part of the public showcase: ${method} ${url.pathname}`);
}

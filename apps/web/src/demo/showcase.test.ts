import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DashboardOverviewSchema,
  PagedApprovalsSchema,
  PagedAuditSchema,
  PagedDeadLettersSchema,
  PagedDeliveriesSchema,
  PagedNotificationsSchema,
  PagedRequestsSchema,
  PagedTeamSchema,
  QueueSnapshotListSchema,
  WebhookEndpointListSchema,
  WorkflowListSchema,
} from '../domain/models';
import { SHOWCASE_IDS } from './fixtures';
import { resetShowcaseState } from './store';
import { showcaseApiResponse } from './transport';

const originalMode = process.env['NEXT_PUBLIC_QUEUEFORGE_MODE'];

describe('public showcase transport', () => {
  beforeEach(() => resetShowcaseState());

  afterEach(() => {
    if (originalMode === undefined) delete process.env['NEXT_PUBLIC_QUEUEFORGE_MODE'];
    else process.env['NEXT_PUBLIC_QUEUEFORGE_MODE'] = originalMode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('serves every representative route through the production schemas', async () => {
    const cases = [
      ['/api/v1/dashboard/overview', DashboardOverviewSchema],
      ['/api/v1/requests?page=1&pageSize=10', PagedRequestsSchema],
      ['/api/v1/approvals?page=1&pageSize=10', PagedApprovalsSchema],
      ['/api/v1/workflows', WorkflowListSchema],
      ['/api/v1/webhooks/endpoints', WebhookEndpointListSchema],
      ['/api/v1/webhooks/deliveries?page=1&pageSize=10', PagedDeliveriesSchema],
      ['/api/v1/operations/queues', QueueSnapshotListSchema],
      ['/api/v1/operations/dead-letters?page=1&pageSize=10', PagedDeadLettersSchema],
      ['/api/v1/notifications?page=1&pageSize=10', PagedNotificationsSchema],
      ['/api/v1/audit?page=1&pageSize=10', PagedAuditSchema],
      ['/api/v1/team/memberships?page=1&pageSize=10', PagedTeamSchema],
    ] as const;

    for (const [path, schema] of cases) {
      const body = await showcaseApiResponse(path, {});
      expect(schema.safeParse(body), path).toMatchObject({ success: true });
    }
  });

  it('retains a synthetic decision and retry lineage in memory', async () => {
    await showcaseApiResponse(`/api/v1/approvals/${SHOWCASE_IDS.approvalPending}/decide`, {
      body: { decision: 'approved', note: 'Approved for the portfolio walkthrough.' },
      method: 'POST',
    });

    const approvals = PagedApprovalsSchema.parse(
      await showcaseApiResponse('/api/v1/approvals?page=1&pageSize=10', {}),
    );
    const deliveries = PagedDeliveriesSchema.parse(
      await showcaseApiResponse('/api/v1/webhooks/deliveries?page=1&pageSize=10', {}),
    );

    expect(approvals.items.find((item) => item.id === SHOWCASE_IDS.approvalPending)?.status).toBe(
      'approved',
    );
    expect(
      deliveries.items.find((item) => item.requestId === SHOWCASE_IDS.expenseRequestPending),
    ).toMatchObject({ attemptCount: 2, status: 'delivered' });
  });

  it('keeps the public api client entirely off the network', async () => {
    process.env['NEXT_PUBLIC_QUEUEFORGE_MODE'] = 'showcase';
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { apiRequest } = await import('../api/client');

    const dashboard = await apiRequest('/api/v1/dashboard/overview', {
      schema: DashboardOverviewSchema,
    });

    expect(dashboard.recentRequests.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

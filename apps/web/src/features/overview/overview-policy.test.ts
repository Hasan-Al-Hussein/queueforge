import { describe, expect, it } from 'vitest';

import type { DashboardOverview } from '../../domain/models';
import { pipelineRail, roleGuide, roleMetrics, rolePriority } from './overview-screen';

const overview: DashboardOverview = {
  queues: [],
  recentRequests: [],
  statusCounts: [
    { count: 4, status: 'pending_approval' },
    { count: 7, status: 'queued' },
    { count: 2, status: 'processing' },
    { count: 11, status: 'succeeded' },
    { count: 3, status: 'rejected' },
    { count: 1, status: 'dead_lettered' },
  ],
  throughput: [],
};

describe('role overview policy', () => {
  it('keeps approver guidance inside decision work and updates', () => {
    const guide = roleGuide('approver');

    expect(guide.title).toBe('Approver quick guide');
    expect(guide.steps.map((step) => step.href)).toEqual([
      '/approvals',
      '/approvals',
      '/notifications',
    ]);
    expect(roleMetrics('approver', overview).map((metric) => metric.label)).toEqual([
      'Waiting for you',
      'Completed',
      'Declined',
    ]);
  });

  it('gives operators daily work without approval or administration links', () => {
    const guide = roleGuide('operator');

    expect(guide.steps.map((step) => step.href)).toEqual(['/requests', '/requests', '/operations']);
    expect(guide.steps.some((step) => step.href === '/approvals')).toBe(false);
  });

  it('gives administrators configuration and access steps', () => {
    expect(roleGuide('tenant_admin').steps.map((step) => step.href)).toEqual([
      '/workflows',
      '/webhooks',
      '/team',
    ]);
  });

  it('makes the approval bottleneck the administrator priority without granting approval access', () => {
    expect(rolePriority('tenant_admin', overview)).toMatchObject({
      actionHref: '/team',
      actionLabel: 'Review approver access',
      metricLabel: 'Waiting for approval',
      tone: 'warning',
      value: 4,
    });
  });

  it('keeps role priorities inside each role boundary', () => {
    expect(rolePriority('approver', overview).actionHref).toBe('/approvals');
    expect(rolePriority('operator', overview).actionHref).toBe('/operations');
    expect(rolePriority('viewer', overview).actionHref).toBe('/requests');
  });

  it('does not present an empty workspace as a completed pipeline', () => {
    const emptyOverview: DashboardOverview = {
      queues: [],
      recentRequests: [],
      statusCounts: [],
      throughput: [],
    };

    expect(pipelineRail(emptyOverview).map((item) => item.state)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(pipelineRail(emptyOverview)[0]?.description).toBe(
      'No requests have entered this workspace yet.',
    );
  });
});

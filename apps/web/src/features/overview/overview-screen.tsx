'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { gql, NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import type { ColumnDef } from '@tanstack/react-table';
import type { TenantRole, WorkflowRequestView } from '@queueforge/contracts';
import {
  ArrowRight,
  Button,
  GitPullRequestArrow,
  Panel,
  QueueRail,
  RefreshCw,
  StatusBadge,
  type QueueRailItem,
} from '@queueforge/ui';

import { AppShell } from '../../components/app-shell';
import { stripGraphqlTypenames } from '../../api/graphql-response';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { MetricStrip, type Metric } from '../../components/metric-strip';
import { PageHeader } from '../../components/page-header';
import { QueryState } from '../../components/query-state';
import { effectiveWorkspaceRole } from '../../components/workspace-access';
import { DashboardOverviewSchema, type DashboardOverview } from '../../domain/models';
import {
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTypeLabel,
} from '../../domain/presentation';
import { useAuth } from '../../providers/auth-provider';

const ThroughputChart = dynamic(
  () => import('./throughput-chart').then((module) => module.ThroughputChart),
  {
    loading: () => (
      <div
        className="qf-throughput-chart qf-chart-placeholder"
        aria-label="Loading throughput chart"
      />
    ),
    ssr: false,
  },
);

const DASHBOARD_QUERY = gql`
  query DashboardOverview {
    dashboardOverview {
      statusCounts {
        status
        count
      }
      queues {
        name
        waiting
        active
        delayed
        failed
      }
      recentRequests {
        id
        workflowId
        workflowVersionId
        workflowName
        versionNo
        status
        source
        payload
        correlationId
        submittedAt
        statusChangedAt
        attemptCount
        maxAttempts
      }
      throughput {
        bucket
        succeeded
        failed
      }
    }
  }
`;

interface DashboardQueryData {
  readonly dashboardOverview: DashboardOverview;
}

const requestColumns: readonly ColumnDef<WorkflowRequestView, unknown>[] = [
  {
    accessorKey: 'id',
    header: 'Request type',
    cell: ({ row }) => (
      <div>
        <Link
          className="qf-table-link"
          href={`/requests/detail?id=${encodeURIComponent(row.original.id)}`}
          prefetch={false}
        >
          {requestTypeLabel(row.original.workflowName)}
        </Link>
        <div className="qf-utility">
          Reference <CompactId value={row.original.id} />
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge status={row.original.status} label={requestStatusLabel(row.original.status)} />
    ),
  },
  {
    accessorKey: 'source',
    header: 'Started from',
    cell: ({ row }) => requestSourceLabel(row.original.source),
  },
  {
    accessorKey: 'attemptCount',
    header: 'Progress',
    cell: ({ row }) => requestProgressLabel(row.original),
  },
  {
    accessorKey: 'statusChangedAt',
    header: 'Updated',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
];

function countFor(overview: DashboardOverview, status: string): number {
  return overview.statusCounts.find((item) => item.status === status)?.count ?? 0;
}

function pipelineRail(overview: DashboardOverview): readonly QueueRailItem[] {
  const pending = countFor(overview, 'pending_approval');
  const queued = countFor(overview, 'queued');
  const processing = countFor(overview, 'processing');
  const failed = countFor(overview, 'failed') + countFor(overview, 'dead_lettered');
  return [
    {
      id: 'intake',
      label: 'Request accepted',
      description: 'The request type and submitted information were checked.',
      state: 'complete',
    },
    {
      id: 'approval',
      label: 'Human decision',
      description: `${String(pending)} request${pending === 1 ? '' : 's'} waiting for a decision.`,
      state: pending > 0 ? 'current' : 'complete',
    },
    {
      id: 'queue',
      label: 'Processing',
      description: `${String(queued)} ready to start · ${String(processing)} running now`,
      state: queued + processing > 0 ? 'current' : 'complete',
    },
    {
      id: 'delivery',
      label: 'Completion and delivery',
      description:
        failed > 0
          ? `${String(failed)} item${failed === 1 ? '' : 's'} need attention.`
          : 'No failed effects in the current view.',
      state: failed > 0 ? 'failed' : 'complete',
    },
  ];
}

interface RoleOverviewCopy {
  readonly actionHref:
    '/' | '/approvals' | '/notifications' | '/operations' | '/requests' | '/workflows';
  readonly actionLabel: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly nextDescription: string;
  readonly nextTitle: string;
  readonly title: string;
}

export interface RoleGuideStep {
  readonly description: string;
  readonly href:
    | '/approvals'
    | '/notifications'
    | '/operations'
    | '/requests'
    | '/team'
    | '/webhooks'
    | '/workflows';
  readonly label: string;
}

interface RoleGuide {
  readonly description: string;
  readonly steps: readonly RoleGuideStep[];
  readonly title: string;
}

export function roleGuide(role: TenantRole): RoleGuide {
  if (role === 'tenant_admin') {
    return {
      description: 'Set up the experience your operators and approvers will use.',
      title: 'Administrator quick guide',
      steps: [
        {
          description: 'Build the form, approval rule, and processing steps.',
          href: '/workflows',
          label: 'Create a request type',
        },
        {
          description: 'Choose where completed results should be sent.',
          href: '/webhooks',
          label: 'Connect another system',
        },
        {
          description: 'Invite people and give each person the right workspace.',
          href: '/team',
          label: 'Manage people and access',
        },
      ],
    };
  }
  if (role === 'operator') {
    return {
      description: 'Start everyday work, follow progress, and recover interrupted requests.',
      title: 'Operator quick guide',
      steps: [
        {
          description: 'Choose a request type and answer its simple questions.',
          href: '/requests',
          label: 'Start a request',
        },
        {
          description: 'Open a request to see approval, processing, and delivery progress.',
          href: '/requests',
          label: 'Track what is happening',
        },
        {
          description: 'Review the reason before safely trying stopped work again.',
          href: '/operations',
          label: 'Resolve processing issues',
        },
      ],
    };
  }
  if (role === 'approver') {
    return {
      description: 'Make clear decisions without being distracted by configuration or queues.',
      title: 'Approver quick guide',
      steps: [
        {
          description: 'Open the requests that are waiting for your judgment.',
          href: '/approvals',
          label: 'Open your approval inbox',
        },
        {
          description: 'Read who requested it and the important information they provided.',
          href: '/approvals',
          label: 'Review the request',
        },
        {
          description: 'Approve or decline, then follow the recorded update.',
          href: '/notifications',
          label: 'Decide and stay updated',
        },
      ],
    };
  }
  return {
    description: 'Follow activity and inspect details without changing operational work.',
    title: 'Viewer quick guide',
    steps: [
      {
        description: 'Browse requests across the selected workspace.',
        href: '/requests',
        label: 'Open request history',
      },
      {
        description: 'Open any request to understand its current status and timeline.',
        href: '/requests',
        label: 'Inspect progress',
      },
      {
        description: 'Read updates addressed to you or your role.',
        href: '/notifications',
        label: 'Check notifications',
      },
    ],
  };
}

export function roleMetrics(role: TenantRole, overview: DashboardOverview): readonly Metric[] {
  if (role === 'approver') {
    return [
      {
        label: 'Waiting for you',
        value: countFor(overview, 'pending_approval'),
        detail: 'Your decision is needed',
      },
      {
        label: 'Completed',
        value: countFor(overview, 'succeeded'),
        detail: 'Finished requests',
      },
      {
        label: 'Declined',
        value: countFor(overview, 'rejected'),
        detail: 'Requests that did not continue',
      },
    ];
  }
  if (role === 'viewer') {
    return [
      {
        label: 'Waiting for approval',
        value: countFor(overview, 'pending_approval'),
        detail: 'A person needs to decide',
      },
      {
        label: 'In progress',
        value: countFor(overview, 'queued') + countFor(overview, 'processing'),
        detail: 'Waiting or running',
      },
      {
        label: 'Completed',
        value: countFor(overview, 'succeeded'),
        detail: 'Finished requests',
      },
    ];
  }
  return [
    {
      label: 'Waiting for approval',
      value: countFor(overview, 'pending_approval'),
      detail: 'A person needs to decide',
    },
    {
      label: 'Ready to start',
      value: countFor(overview, 'queued'),
      detail: 'Safely waiting in line',
    },
    {
      label: 'Running now',
      value: countFor(overview, 'processing'),
      detail: 'Being processed',
    },
    {
      label: 'Needs attention',
      value: countFor(overview, 'failed') + countFor(overview, 'dead_lettered'),
      detail: 'Stopped after automatic retries',
    },
  ];
}

function roleOverviewCopy(role: TenantRole, overview: DashboardOverview): RoleOverviewCopy {
  const pending = countFor(overview, 'pending_approval');
  const attention = countFor(overview, 'failed') + countFor(overview, 'dead_lettered');
  if (role === 'approver') {
    return pending > 0
      ? {
          actionHref: '/approvals',
          actionLabel: 'Review decisions',
          description: 'Focus on the requests that need your judgment and stay up to date.',
          eyebrow: 'Approval workspace',
          nextDescription: 'Open each request, check the important facts, then approve or decline.',
          nextTitle: `${String(pending)} decision${pending === 1 ? '' : 's'} waiting for you`,
          title: 'Approval overview',
        }
      : {
          actionHref: '/notifications',
          actionLabel: 'View notifications',
          description: 'Focus on the requests that need your judgment and stay up to date.',
          eyebrow: 'Approval workspace',
          nextDescription: 'There are no requests waiting for your decision right now.',
          nextTitle: 'You are all caught up',
          title: 'Approval overview',
        };
  }
  if (role === 'operator') {
    return attention > 0
      ? {
          actionHref: '/operations',
          actionLabel: 'Review processing issues',
          description: 'Start requests, keep work moving, and recover anything that needs help.',
          eyebrow: 'Operations workspace',
          nextDescription: 'QueueForge kept the work safe so you can inspect it and try again.',
          nextTitle: `${String(attention)} item${attention === 1 ? '' : 's'} need attention`,
          title: 'Operations overview',
        }
      : {
          actionHref: '/requests',
          actionLabel: 'Start or track requests',
          description: 'Start requests, keep work moving, and recover anything that needs help.',
          eyebrow: 'Operations workspace',
          nextDescription:
            'Choose a request type, answer the simple questions, and follow progress here.',
          nextTitle: 'Start or track a request',
          title: 'Operations overview',
        };
  }
  if (role === 'tenant_admin') {
    return attention > 0
      ? {
          actionHref: '/operations',
          actionLabel: 'Review system health',
          description: 'Configure how work runs, manage access, and monitor the system.',
          eyebrow: 'Admin workspace',
          nextDescription:
            'Review the safe recovery options without mixing them into daily request work.',
          nextTitle: `${String(attention)} processing issue${attention === 1 ? '' : 's'} to review`,
          title: 'Administration overview',
        }
      : {
          actionHref: '/workflows',
          actionLabel: 'Manage request types',
          description: 'Configure how work runs, manage access, and monitor the system.',
          eyebrow: 'Admin workspace',
          nextDescription:
            'Keep forms, approval rules, and delivery steps easy for each role to use.',
          nextTitle: 'Review your request types',
          title: 'Administration overview',
        };
  }
  return {
    actionHref: '/requests',
    actionLabel: 'View request history',
    description: 'See what is happening without changing operational or configuration settings.',
    eyebrow: 'Read-only workspace',
    nextDescription: 'Open recent requests to understand their latest status and progress.',
    nextTitle: 'Review recent activity',
    title: 'Workspace overview',
  };
}

export function OverviewScreen(): React.JSX.Element {
  const { session } = useAuth();
  const query = useQuery<DashboardQueryData>(DASHBOARD_QUERY, {
    notifyOnNetworkStatusChange: true,
  });
  const parsed = useMemo(() => {
    if (query.data === undefined) return null;
    const result = DashboardOverviewSchema.safeParse(
      stripGraphqlTypenames(query.data.dashboardOverview, [
        ['statusCounts', '*'],
        ['queues', '*'],
        ['recentRequests', '*'],
        ['throughput', '*'],
      ]),
    );
    return result.success ? result.data : null;
  }, [query.data]);
  const invalidResponse =
    query.data !== undefined && parsed === null
      ? new Error('Dashboard response did not match the contract.')
      : null;
  const error = query.error ?? invalidResponse;
  const workspaceRole: TenantRole =
    session === null
      ? 'viewer'
      : effectiveWorkspaceRole(session.selectedTenant.role, session.user.platformRole);
  const copy = parsed === null ? null : roleOverviewCopy(workspaceRole, parsed);
  const guide = roleGuide(workspaceRole);

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={query.networkStatus === NetworkStatus.refetch}
            onClick={() => void query.refetch()}
          >
            Refresh
          </Button>
        }
        description={copy?.description ?? 'See the most important work for your role.'}
        eyebrow={copy?.eyebrow ?? 'QueueForge'}
        title={copy?.title ?? 'Workspace overview'}
      />
      <QueryState
        empty={
          parsed !== null && parsed.statusCounts.length === 0 && parsed.recentRequests.length === 0
        }
        emptyAction={
          <Link
            className="qf-button qf-button--primary"
            href={workspaceRole === 'tenant_admin' ? '/workflows' : '/notifications'}
            prefetch={false}
          >
            {workspaceRole === 'tenant_admin' ? 'Create a request type' : 'View notifications'}
          </Link>
        }
        emptyDescription="Activity will appear here as people start and complete requests."
        emptyTitle="No request activity yet"
        error={error}
        isLoading={query.loading && parsed === null}
        onRetry={() => void query.refetch()}
      >
        {parsed !== null ? (
          <>
            <section className="qf-next-step" aria-labelledby="next-step-title">
              <div>
                <p className="qf-eyebrow">Your next step</p>
                <h2 id="next-step-title">{copy?.nextTitle}</h2>
                <p>{copy?.nextDescription}</p>
              </div>
              <Link
                className="qf-button qf-button--primary"
                href={copy?.actionHref ?? '/'}
                prefetch={false}
              >
                {copy?.actionLabel}
                <ArrowRight size={16} />
              </Link>
            </section>
            <MetricStrip items={roleMetrics(workspaceRole, parsed)} />
            <Panel
              className="qf-getting-started"
              title={guide.title}
              description={guide.description}
            >
              <ol className="qf-journey-guide">
                {guide.steps.map((step, index) => (
                  <li key={`${step.href}-${step.label}`}>
                    <span>{String(index + 1)}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <p>{step.description}</p>
                      <Link className="qf-guide-link" href={step.href} prefetch={false}>
                        Open this step <ArrowRight aria-hidden="true" size={14} />
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
            <div className="qf-content-grid qf-content-grid--overview">
              {workspaceRole === 'operator' || workspaceRole === 'tenant_admin' ? (
                <Panel
                  title="Completed work"
                  description="Successful and failed requests over the visible period."
                >
                  {parsed.throughput.length > 0 ? (
                    <ThroughputChart points={parsed.throughput} />
                  ) : (
                    <p className="qf-chart-summary">
                      No throughput points are available for this interval.
                    </p>
                  )}
                </Panel>
              ) : null}
              {workspaceRole === 'operator' || workspaceRole === 'tenant_admin' ? (
                <Panel
                  title="How work is moving"
                  description="A simple view of the request journey right now."
                >
                  <QueueRail items={pipelineRail(parsed)} ariaLabel="Current request journey" />
                </Panel>
              ) : null}
              {workspaceRole === 'tenant_admin' ? null : (
                <Panel
                  className="qf-span-full"
                  title="Recent requests"
                  description="Latest status changes across this workspace."
                  actions={
                    workspaceRole === 'operator' || workspaceRole === 'viewer' ? (
                      <Link
                        className="qf-button qf-button--quiet"
                        href="/requests"
                        prefetch={false}
                      >
                        Open history <ArrowRight size={15} />
                      </Link>
                    ) : undefined
                  }
                >
                  <DataTable
                    ariaLabel="Recent workflow requests"
                    columns={requestColumns}
                    getRowId={(row) => row.id}
                    rows={parsed.recentRequests}
                    search={{
                      label: 'Search recent requests',
                      placeholder: 'Request type, status, or reference',
                      text: (row) => `${row.id} ${row.workflowName} ${row.status} ${row.source}`,
                    }}
                  />
                </Panel>
              )}
              <details className="qf-span-full qf-technical-note">
                <summary>
                  <GitPullRequestArrow size={18} aria-hidden="true" />
                  How QueueForge keeps work safe
                </summary>
                <p>
                  Requests are saved before background processing starts. Stable event IDs and
                  durable receipts prevent QueueForge from repeating its own database effects, even
                  when a worker retries.
                </p>
              </details>
            </div>
          </>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

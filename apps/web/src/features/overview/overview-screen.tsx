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
  RefreshCw,
  StatusBadge,
  type QueueRailItem,
} from '@queueforge/ui';

import { AppShell } from '../../components/app-shell';
import { stripGraphqlTypenames } from '../../api/graphql-response';
import { RevealGroup, RevealItem, ScrollReveal } from '../../components/cinematic-motion';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import type { Metric } from '../../components/metric-strip';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
import { effectiveWorkspaceRole } from '../../components/workspace-access';
import { DashboardOverviewSchema, type DashboardOverview } from '../../domain/models';
import {
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTypeLabel,
} from '../../domain/presentation';
import { useAuth } from '../../providers/auth-provider';

import styles from './overview-screen.module.css';

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

const DurablePipelineScene = dynamic(
  () => import('./durable-pipeline-scene').then((module) => module.DurablePipelineScene),
  {
    loading: () => (
      <div className="qf-durable-scene qf-durable-scene--loading" aria-hidden="true" />
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

export function pipelineRail(overview: DashboardOverview): readonly QueueRailItem[] {
  const pending = countFor(overview, 'pending_approval');
  const queued = countFor(overview, 'queued');
  const processing = countFor(overview, 'processing');
  const failed = countFor(overview, 'failed') + countFor(overview, 'dead_lettered');
  const hasRequestActivity = overview.statusCounts.some((item) => item.count > 0);

  if (!hasRequestActivity) {
    return [
      {
        id: 'intake',
        label: 'Request accepted',
        description: 'No requests have entered this workspace yet.',
        state: 'pending',
      },
      {
        id: 'approval',
        label: 'Human decision',
        description: 'This stage begins when a submitted request needs approval.',
        state: 'pending',
      },
      {
        id: 'queue',
        label: 'Processing',
        description: 'Approved work will be processed here.',
        state: 'pending',
      },
      {
        id: 'delivery',
        label: 'Completion and delivery',
        description: 'Completed results will be delivered and recorded here.',
        state: 'pending',
      },
    ];
  }

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
    '/' | '/approvals' | '/notifications' | '/operations' | '/requests' | '/team' | '/workflows';
  readonly actionLabel: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly nextDescription: string;
  readonly nextTitle: string;
  readonly title: string;
}

type PriorityTone = 'danger' | 'neutral' | 'signal' | 'warning';

export interface OverviewPriority {
  readonly actionHref:
    '/approvals' | '/notifications' | '/operations' | '/requests' | '/team' | '/workflows';
  readonly actionLabel: string;
  readonly description: string;
  readonly label: string;
  readonly metricLabel?: string;
  readonly tone: PriorityTone;
  readonly value: number;
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

export function rolePriority(role: TenantRole, overview: DashboardOverview): OverviewPriority {
  const pending = countFor(overview, 'pending_approval');
  const queued = countFor(overview, 'queued');
  const processing = countFor(overview, 'processing');
  const attention = countFor(overview, 'failed') + countFor(overview, 'dead_lettered');

  if (role === 'approver') {
    return pending > 0
      ? {
          actionHref: '/approvals',
          actionLabel: 'Review approval inbox',
          description:
            'Open the next request, verify the important facts, then approve or decline it.',
          label: `request${pending === 1 ? '' : 's'} waiting for your decision`,
          metricLabel: 'Waiting for you',
          tone: 'warning',
          value: pending,
        }
      : {
          actionHref: '/notifications',
          actionLabel: 'View notifications',
          description: 'There are no requests waiting for your decision right now.',
          label: 'decisions waiting',
          metricLabel: 'Waiting for you',
          tone: 'signal',
          value: 0,
        };
  }

  if (role === 'operator') {
    if (attention > 0) {
      return {
        actionHref: '/operations',
        actionLabel: 'Review processing issues',
        description: 'QueueForge kept this work safe so you can inspect it before trying again.',
        label: `item${attention === 1 ? '' : 's'} need recovery`,
        metricLabel: 'Needs attention',
        tone: 'danger',
        value: attention,
      };
    }

    const activeWork = queued + processing;
    return activeWork > 0
      ? {
          actionHref: '/requests',
          actionLabel: 'Track active requests',
          description: 'Follow the requests that are waiting to start or processing now.',
          label: `request${activeWork === 1 ? '' : 's'} in motion`,
          metricLabel: 'Ready to start',
          tone: 'signal',
          value: activeWork,
        }
      : {
          actionHref: '/requests',
          actionLabel: 'Start a request',
          description: 'Processing is clear. Start the next request when the work is ready.',
          label: 'processing issues',
          metricLabel: 'Needs attention',
          tone: 'signal',
          value: 0,
        };
  }

  if (role === 'tenant_admin') {
    if (pending > 0) {
      return {
        actionHref: '/team',
        actionLabel: 'Review approver access',
        description:
          'The requests are safe, but an assigned approver must decide before processing can begin.',
        label: `request${pending === 1 ? '' : 's'} waiting for approval`,
        metricLabel: 'Waiting for approval',
        tone: 'warning',
        value: pending,
      };
    }

    return attention > 0
      ? {
          actionHref: '/operations',
          actionLabel: 'Review system health',
          description: 'Inspect the recorded failure and choose the safe recovery path.',
          label: `processing issue${attention === 1 ? '' : 's'} to review`,
          metricLabel: 'Needs attention',
          tone: 'danger',
          value: attention,
        }
      : {
          actionHref: '/workflows',
          actionLabel: 'Manage request types',
          description: 'The operational queue is clear. Review forms, rules, and delivery steps.',
          label: 'processing issues',
          metricLabel: 'Needs attention',
          tone: 'signal',
          value: 0,
        };
  }

  const activeWork = pending + queued + processing;
  return {
    actionHref: '/requests',
    actionLabel: 'View request history',
    description:
      activeWork > 0
        ? 'Open a request to understand its current status and latest recorded change.'
        : 'There is no active work in this workspace right now.',
    label: `active request${activeWork === 1 ? '' : 's'}`,
    tone: activeWork > 0 ? 'neutral' : 'signal',
    value: activeWork,
  };
}

function roleOverviewCopy(role: TenantRole, overview: DashboardOverview): RoleOverviewCopy {
  const priority = rolePriority(role, overview);

  if (role === 'approver') {
    return {
      actionHref: priority.actionHref,
      actionLabel: priority.actionLabel,
      description: 'Focus on decisions that need your judgment and the updates that follow.',
      eyebrow: 'Approval workspace',
      nextDescription: priority.description,
      nextTitle: `${String(priority.value)} ${priority.label}`,
      title: 'Approval overview',
    };
  }

  if (role === 'operator') {
    return {
      actionHref: priority.actionHref,
      actionLabel: priority.actionLabel,
      description: 'Start requests, keep work moving, and recover anything that needs help.',
      eyebrow: 'Operations workspace',
      nextDescription: priority.description,
      nextTitle: `${String(priority.value)} ${priority.label}`,
      title: 'Operations overview',
    };
  }

  if (role === 'tenant_admin') {
    return {
      actionHref: priority.actionHref,
      actionLabel: priority.actionLabel,
      description: 'Monitor bottlenecks, manage access, and keep request types healthy.',
      eyebrow: 'Admin workspace',
      nextDescription: priority.description,
      nextTitle: `${String(priority.value)} ${priority.label}`,
      title: 'Admin overview',
    };
  }

  return {
    actionHref: priority.actionHref,
    actionLabel: priority.actionLabel,
    description: 'See what is happening without changing operational or configuration settings.',
    eyebrow: 'Read-only workspace',
    nextDescription: priority.description,
    nextTitle: `${String(priority.value)} ${priority.label}`,
    title: 'Workspace overview',
  };
}

function supportingMetricTone(label: string): PriorityTone {
  const normalized = label.toLowerCase();
  if (normalized.includes('attention') || normalized.includes('declined')) return 'danger';
  if (normalized.includes('waiting')) return 'warning';
  if (normalized.includes('completed') || normalized.includes('running')) return 'signal';
  return 'neutral';
}

function OverviewWorkStatus({
  metrics,
  priority,
}: {
  readonly metrics: readonly Metric[];
  readonly priority: OverviewPriority;
}): React.JSX.Element {
  const supportingMetrics = metrics.filter((metric) => metric.label !== priority.metricLabel);

  return (
    <section className={styles.workStatus} aria-labelledby="overview-priority-title">
      <div className={styles.priority} data-tone={priority.tone}>
        <div className={styles.priorityCopy}>
          <p className="qf-eyebrow">Priority now</p>
          <h2 id="overview-priority-title">
            <span className={styles.priorityValue}>{priority.value}</span>
            <span>{priority.label}</span>
          </h2>
          <p>{priority.description}</p>
        </div>
        <Link
          className={`qf-button qf-button--primary ${styles.priorityAction}`}
          href={priority.actionHref}
          prefetch={false}
        >
          {priority.actionLabel}
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </div>
      <dl className={styles.supportingMetrics} aria-label="Other workspace status">
        {supportingMetrics.map((metric) => (
          <div
            className={styles.supportingMetric}
            data-tone={supportingMetricTone(metric.label)}
            data-zero={metric.value === 0 ? 'true' : 'false'}
            key={metric.label}
          >
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            {metric.detail === undefined ? null : <dd>{metric.detail}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
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
  const showOperationalRail = workspaceRole === 'operator' || workspaceRole === 'tenant_admin';
  const railItems = useMemo(() => (parsed === null ? [] : pipelineRail(parsed)), [parsed]);
  const priority = parsed === null ? null : rolePriority(workspaceRole, parsed);
  const metrics = parsed === null ? [] : roleMetrics(workspaceRole, parsed);

  return (
    <AppShell>
      <RouteHero
        className={styles.overviewHero}
        actions={
          <>
            {copy === null ? null : (
              <Link
                className={`qf-button qf-button--primary ${styles.landscapePrimaryAction}`}
                href={copy.actionHref}
                prefetch={false}
              >
                {copy.actionLabel}
                <ArrowRight aria-hidden="true" size={16} />
              </Link>
            )}
            <Button
              icon={<RefreshCw size={16} />}
              loading={query.networkStatus === NetworkStatus.refetch}
              onClick={() => void query.refetch()}
              tone="quiet"
            >
              Refresh
            </Button>
          </>
        }
        description={copy?.description ?? 'See the most important work for your role.'}
        eyebrow={copy?.eyebrow ?? 'QueueForge'}
        icon={<GitPullRequestArrow size={19} />}
        meta={
          copy === null ? undefined : (
            <span className={styles.heroPriority}>Priority now · {copy.nextTitle}</span>
          )
        }
        title={copy?.title ?? 'Workspace overview'}
        variant={showOperationalRail ? 'feature' : 'compact'}
        visual={
          parsed !== null && showOperationalRail ? (
            <div className={styles.proofScene}>
              <DurablePipelineScene items={railItems} />
            </div>
          ) : undefined
        }
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
            {priority === null ? null : (
              <ScrollReveal>
                <OverviewWorkStatus metrics={metrics} priority={priority} />
              </ScrollReveal>
            )}
            <RevealGroup className="qf-content-grid qf-content-grid--overview">
              <RevealItem className="qf-span-full">
                <Panel
                  title="Recent request activity"
                  description="Latest status changes across this workspace."
                  actions={
                    workspaceRole === 'operator' || workspaceRole === 'viewer' ? (
                      <Link
                        className="qf-button qf-button--quiet"
                        href="/requests"
                        prefetch={false}
                      >
                        Open request history <ArrowRight aria-hidden="true" size={15} />
                      </Link>
                    ) : workspaceRole === 'approver' ? (
                      <Link
                        className="qf-button qf-button--quiet"
                        href="/approvals"
                        prefetch={false}
                      >
                        Open approval inbox <ArrowRight aria-hidden="true" size={15} />
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
              </RevealItem>
              {showOperationalRail ? (
                <RevealItem>
                  <Panel
                    title="Request throughput"
                    description="Successful and failed requests in the visible period."
                  >
                    {parsed.throughput.length > 0 ? (
                      <ThroughputChart points={parsed.throughput} />
                    ) : (
                      <p className="qf-chart-summary">
                        No throughput points are available for this interval.
                      </p>
                    )}
                  </Panel>
                </RevealItem>
              ) : null}
              {showOperationalRail ? (
                <RevealItem>
                  <Panel
                    className="qf-evidence-panel"
                    title="Durability controls"
                    description="The record stays authoritative if processing or delivery repeats."
                  >
                    <dl className="qf-evidence-ledger">
                      <div>
                        <dt>Before dispatch</dt>
                        <dd>Request state and outbox event commit together.</dd>
                      </div>
                      <div>
                        <dt>During retries</dt>
                        <dd>Stable event IDs and receipts prevent repeated QueueForge effects.</dd>
                      </div>
                      <div>
                        <dt>After delivery</dt>
                        <dd>The signed attempt and correlation trail remain inspectable.</dd>
                      </div>
                    </dl>
                  </Panel>
                </RevealItem>
              ) : null}
              <RevealItem className="qf-span-full">
                <details className="qf-technical-note">
                  <summary>
                    <GitPullRequestArrow size={18} aria-hidden="true" />
                    How QueueForge keeps work safe
                  </summary>
                  <p>
                    Requests are saved before background processing starts. Stable event IDs and
                    durable receipts prevent QueueForge from repeating its own database effects,
                    even when a worker retries.
                  </p>
                </details>
              </RevealItem>
            </RevealGroup>
            {workspaceRole === 'tenant_admin' ? null : (
              <ScrollReveal>
                <details className={`qf-getting-started ${styles.roleGuide}`}>
                  <summary>
                    <span>
                      <strong>{guide.title}</strong>
                      <small>{guide.description}</small>
                    </span>
                    <span aria-hidden="true">Role guide</span>
                  </summary>
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
                </details>
              </ScrollReveal>
            )}
          </>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

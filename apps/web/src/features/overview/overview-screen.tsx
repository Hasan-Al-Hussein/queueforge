'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { gql, NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import type { ColumnDef } from '@tanstack/react-table';
import type { WorkflowRequestView } from '@queueforge/contracts';
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
import { MetricStrip } from '../../components/metric-strip';
import { PageHeader } from '../../components/page-header';
import { QueryState } from '../../components/query-state';
import { DashboardOverviewSchema, type DashboardOverview } from '../../domain/models';

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
    header: 'Request',
    cell: ({ row }) => (
      <div>
        <Link
          className="qf-table-link"
          href={`/requests/detail?id=${encodeURIComponent(row.original.id)}`}
          prefetch={false}
        >
          {row.original.workflowName}
        </Link>
        <div>
          <CompactId value={row.original.id} />
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    accessorKey: 'source',
    header: 'Source',
    cell: ({ getValue }) => String(getValue()).replaceAll('_', ' '),
  },
  {
    accessorKey: 'attemptCount',
    header: 'Attempts',
    cell: ({ row }) => (
      <span className="qf-mono">
        {row.original.attemptCount}/{row.original.maxAttempts}
      </span>
    ),
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
      label: 'Intake validated',
      description: 'Tenant and workflow version are bound.',
      state: 'complete',
    },
    {
      id: 'approval',
      label: 'Approval gate',
      description: `${String(pending)} request${pending === 1 ? '' : 's'} waiting for a decision.`,
      state: pending > 0 ? 'current' : 'complete',
    },
    {
      id: 'queue',
      label: 'Durable dispatch',
      description: `${String(queued)} waiting · ${String(processing)} active`,
      state: queued + processing > 0 ? 'current' : 'complete',
    },
    {
      id: 'delivery',
      label: 'Effect delivery',
      description:
        failed > 0
          ? `${String(failed)} item${failed === 1 ? '' : 's'} need attention.`
          : 'No failed effects in the current view.',
      state: failed > 0 ? 'failed' : 'complete',
    },
  ];
}

export function OverviewScreen(): React.JSX.Element {
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
        description="Watch request flow, queue pressure, and intervention points for the selected tenant."
        eyebrow="Tenant operations"
        title="Control overview"
      />
      <QueryState
        empty={
          parsed !== null && parsed.statusCounts.length === 0 && parsed.recentRequests.length === 0
        }
        emptyAction={
          <Link className="qf-button qf-button--primary" href="/workflows" prefetch={false}>
            Configure a workflow
          </Link>
        }
        emptyDescription="Activate a workflow and submit its first synthetic request to populate the control desk."
        emptyTitle="No workflow activity yet"
        error={error}
        isLoading={query.loading && parsed === null}
        onRetry={() => void query.refetch()}
      >
        {parsed !== null ? (
          <>
            <MetricStrip
              items={[
                {
                  label: 'Pending approval',
                  value: countFor(parsed, 'pending_approval'),
                  detail: 'Human decision required',
                },
                {
                  label: 'Queued',
                  value: countFor(parsed, 'queued'),
                  detail: 'Committed for dispatch',
                },
                {
                  label: 'Processing',
                  value: countFor(parsed, 'processing'),
                  detail: 'Workers executing',
                },
                {
                  label: 'Needs attention',
                  value: countFor(parsed, 'failed') + countFor(parsed, 'dead_lettered'),
                  detail: 'Failed or dead-lettered',
                },
              ]}
            />
            <div className="qf-content-grid qf-content-grid--overview">
              <Panel
                title="Throughput"
                description="Succeeded and failed requests by local time bucket."
              >
                {parsed.throughput.length > 0 ? (
                  <ThroughputChart points={parsed.throughput} />
                ) : (
                  <p className="qf-chart-summary">
                    No throughput points are available for this interval.
                  </p>
                )}
              </Panel>
              <Panel
                title="Queue rail"
                description="The current path from accepted work to delivered effects."
              >
                <QueueRail items={pipelineRail(parsed)} ariaLabel="Current request pipeline" />
              </Panel>
              <Panel
                className="qf-span-full"
                title="Recent requests"
                description="Latest status changes across this tenant."
                actions={
                  <Link className="qf-button qf-button--quiet" href="/requests" prefetch={false}>
                    Open all <ArrowRight size={15} />
                  </Link>
                }
              >
                <DataTable
                  ariaLabel="Recent workflow requests"
                  columns={requestColumns}
                  getRowId={(row) => row.id}
                  rows={parsed.recentRequests}
                  search={{
                    label: 'Search recent requests',
                    placeholder: 'Workflow, status, or ID',
                    text: (row) => `${row.id} ${row.workflowName} ${row.status} ${row.source}`,
                  }}
                />
              </Panel>
              <Panel className="qf-span-full qf-control-note" title="Delivery semantics">
                <div className="qf-control-note__content">
                  <GitPullRequestArrow size={20} aria-hidden="true" />
                  <p>
                    PostgreSQL is authoritative; BullMQ coordinates at-least-once processing. Stable
                    event IDs and durable receipts prevent repeated database effects, while external
                    receivers remain responsible for idempotency.
                  </p>
                </div>
              </Panel>
            </div>
          </>
        ) : null}
      </QueryState>
    </AppShell>
  );
}

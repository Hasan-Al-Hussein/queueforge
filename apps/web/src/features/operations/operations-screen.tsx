'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, Button, Dialog, Panel, RefreshCw, RotateCcw, StatusBadge } from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { MetricStrip } from '../../components/metric-strip';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import {
  PagedDeadLettersSchema,
  QueueSnapshotListSchema,
  type DeadLetter,
  type QueueSnapshot,
} from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

function QueueRow({ queue }: { readonly queue: QueueSnapshot }): React.JSX.Element {
  if (!queue.telemetryAvailable) {
    return (
      <div className="qf-queue-row qf-queue-row--tenant">
        <div>
          <strong>{queue.name}</strong>
          <span>Tenant outbox lane</span>
        </div>
        <div className="qf-queue-row__outbox">
          <span>Persisted tenant outbox</span>
          <strong>
            {String(queue.outboxBacklog)} ready · {String(queue.outboxDead)} dead
          </strong>
        </div>
      </div>
    );
  }

  const total = queue.waiting + queue.active + queue.delayed + queue.failed;
  const workerLabel =
    queue.workerState === 'offline'
      ? 'offline'
      : queue.workerState === 'draining'
        ? 'draining'
        : queue.paused
          ? 'queue paused'
          : 'running';
  return (
    <div className="qf-queue-row">
      <div>
        <strong>{queue.name}</strong>
        <span>BullMQ queue</span>
      </div>
      <div>
        <span>Waiting</span>
        <strong>{queue.waiting}</strong>
      </div>
      <div>
        <span>Active</span>
        <strong>{queue.active}</strong>
      </div>
      <div>
        <span>Delayed</span>
        <strong>{queue.delayed}</strong>
      </div>
      <div>
        <span>Failed</span>
        <strong>{queue.failed}</strong>
      </div>
      <StatusBadge
        status={
          queue.workerState === 'offline'
            ? 'failed'
            : queue.workerState === 'draining'
              ? 'retry'
              : queue.paused
                ? 'retired'
                : queue.failed > 0
                  ? 'failed'
                  : total > 0
                    ? 'processing'
                    : 'healthy'
        }
        label={
          queue.workerState !== 'running'
            ? workerLabel
            : queue.paused
              ? workerLabel
              : queue.failed > 0
                ? 'needs attention'
                : total > 0
                  ? 'working'
                  : 'clear'
        }
      />
      <div className="qf-queue-row__runtime">
        <span>Worker freshness</span>
        <strong>
          {String(queue.workerCount)} worker{queue.workerCount === 1 ? '' : 's'} · {workerLabel}
        </strong>
        <small>
          {queue.heartbeatAt === null ? (
            'No heartbeat recorded'
          ) : (
            <>
              Last heartbeat <DateTime value={queue.heartbeatAt} />
            </>
          )}
        </small>
      </div>
      <div className="qf-queue-row__outbox">
        <span>Persisted tenant outbox</span>
        <strong>
          {String(queue.outboxBacklog)} ready · {String(queue.outboxDead)} dead
        </strong>
      </div>
    </div>
  );
}

export function OperationsScreen(): React.JSX.Element {
  const deadLetterPagination = usePagination();
  const [retryItem, setRetryItem] = useState<DeadLetter | null>(null);
  const { online } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const queuesQuery = useQuery({
    queryKey: ['queues'],
    queryFn: ({ signal }) => apiRequest(routes.queues, { schema: QueueSnapshotListSchema, signal }),
    refetchInterval: 15_000,
  });
  const deadLettersQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['dead-letters', deadLetterPagination.page, deadLetterPagination.pageSize],
    queryFn: ({ signal }) =>
      apiRequest(`${routes.deadLetters}?${pageSearchParams(deadLetterPagination).toString()}`, {
        schema: PagedDeadLettersSchema,
        signal,
      }),
  });
  const retryMutation = useMutation({
    mutationFn: (item: DeadLetter) =>
      apiRequest<unknown>(routes.retryDeadLetter(item.id), {
        method: 'POST',
      }),
    onSuccess: async () => {
      notify('Dead-lettered request re-queued.', 'success');
      setRetryItem(null);
      deadLetterPagination.resetPage();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dead-letters'] }),
        queryClient.invalidateQueries({ queryKey: ['queues'] }),
      ]);
    },
  });
  const queueRows = queuesQuery.data ?? [];
  const deadLetters = deadLettersQuery.data?.items ?? [];
  const telemetryAvailable = queueRows.some((queue) => queue.telemetryAvailable);
  const totals = queueRows.reduce(
    (acc, queue) => ({
      active: acc.active + queue.active,
      delayed: acc.delayed + queue.delayed,
      failed: acc.failed + queue.failed,
      outboxBacklog: acc.outboxBacklog + queue.outboxBacklog,
      outboxDead: acc.outboxDead + queue.outboxDead,
      waiting: acc.waiting + queue.waiting,
    }),
    { active: 0, delayed: 0, failed: 0, outboxBacklog: 0, outboxDead: 0, waiting: 0 },
  );
  const columns: readonly ColumnDef<DeadLetter, unknown>[] = [
    {
      accessorKey: 'workflowName',
      header: 'Request',
      cell: ({ row }) => (
        <div>
          <Link
            className="qf-table-link"
            href={`/requests/detail?id=${encodeURIComponent(row.original.requestId)}`}
            prefetch={false}
          >
            {row.original.workflowName}
          </Link>
          <div>
            <CompactId value={row.original.requestId} />
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'reason',
      header: 'Failure reason',
      cell: ({ getValue }) => <span className="qf-wrap-cell">{String(getValue())}</span>,
    },
    {
      accessorKey: 'attemptCount',
      header: 'Attempts',
      cell: ({ getValue }) => <span className="qf-mono">{String(getValue())}</span>,
    },
    {
      accessorKey: 'deadLetteredAt',
      header: 'Dead-lettered',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
    {
      id: 'retry',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => (
        <PermissionGate permission="retry">
          <Button
            aria-label={`Retry ${row.original.workflowName}`}
            disabled={!online}
            icon={<RotateCcw size={15} />}
            onClick={() => setRetryItem(row.original)}
            tone="quiet"
          />
        </PermissionGate>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={queuesQuery.isFetching || deadLettersQuery.isFetching}
            onClick={() => {
              void queuesQuery.refetch();
              void deadLettersQuery.refetch();
            }}
          >
            Refresh
          </Button>
        }
        description="Inspect queue pressure, worker-visible backlog, and exhausted request attempts."
        eyebrow="Durable processing"
        title="Queues & dead letters"
      />
      <MetricStrip
        items={
          telemetryAvailable
            ? [
                { label: 'Waiting', value: totals.waiting, detail: 'Ready for a worker' },
                { label: 'Active', value: totals.active, detail: 'Currently executing' },
                { label: 'Delayed', value: totals.delayed, detail: 'Backoff scheduled' },
                { label: 'Failed jobs', value: totals.failed, detail: 'BullMQ failure count' },
                {
                  label: 'Outbox ready',
                  value: totals.outboxBacklog,
                  detail: 'Persisted tenant events awaiting dispatch',
                },
                {
                  label: 'Outbox dead',
                  value: totals.outboxDead,
                  detail: 'Persisted tenant dispatch failures',
                },
              ]
            : [
                {
                  label: 'Outbox ready',
                  value: totals.outboxBacklog,
                  detail: 'Tenant-scoped events awaiting dispatch',
                },
                {
                  label: 'Outbox dead',
                  value: totals.outboxDead,
                  detail: 'Tenant-scoped dispatch failures',
                },
              ]
        }
      />
      <div className="qf-content-grid">
        <Panel
          title="Queue telemetry"
          description={
            telemetryAvailable
              ? 'Global BullMQ telemetry and worker freshness auto-refresh every 15 seconds.'
              : 'Tenant principals see persisted outbox pressure only; global worker telemetry requires platform administration.'
          }
          actions={
            <span className="qf-save-state">
              <Activity size={15} />
              {telemetryAvailable ? 'Live polling' : 'Tenant scope'}
            </span>
          }
        >
          <QueryState
            empty={queuesQuery.isSuccess && queueRows.length === 0}
            emptyDescription="The worker has not reported any QueueForge queues."
            emptyTitle="No queue telemetry"
            error={queuesQuery.error}
            isLoading={queuesQuery.isLoading}
            onRetry={() => void queuesQuery.refetch()}
          >
            <div>
              {queueRows.map((queue) => (
                <QueueRow key={queue.name} queue={queue} />
              ))}
            </div>
          </QueryState>
        </Panel>
        <Panel
          title="Request dead-letter queue"
          description="Exhausted request processing only; webhook delivery failures are tracked separately."
        >
          <QueryState
            empty={deadLettersQuery.isSuccess && deadLetters.length === 0}
            emptyDescription="No request has exhausted its bounded retry policy."
            emptyTitle="Dead-letter queue is clear"
            error={deadLettersQuery.error}
            isLoading={deadLettersQuery.isLoading}
            onRetry={() => void deadLettersQuery.refetch()}
          >
            <DataTable
              ariaLabel="Dead-lettered workflow requests"
              columns={columns}
              getRowId={(row) => row.id}
              rows={deadLetters}
              search={{
                label: 'Search dead letters',
                placeholder: 'Workflow, request ID, or reason',
                text: (row) => `${row.workflowName} ${row.requestId} ${row.reason}`,
              }}
            />
          </QueryState>
          {deadLettersQuery.data?.meta === undefined ? null : (
            <PaginationControls
              ariaLabel="Dead letters"
              disabled={deadLettersQuery.isFetching}
              meta={deadLettersQuery.data.meta}
              onPageChange={deadLetterPagination.setPage}
              onPageSizeChange={deadLetterPagination.setPageSize}
              page={deadLetterPagination.page}
              pageSize={deadLetterPagination.pageSize}
            />
          )}
        </Panel>
      </div>
      <Dialog
        description="The original failure history remains append-only. A new authorized transition returns the request to queued."
        footer={
          <>
            <Button onClick={() => setRetryItem(null)}>Cancel</Button>
            <Button
              disabled={!online}
              loading={retryMutation.isPending}
              loadingLabel="Re-queueing"
              onClick={() => {
                if (retryItem !== null) retryMutation.mutate(retryItem);
              }}
              tone="primary"
            >
              Confirm manual retry
            </Button>
          </>
        }
        onClose={() => setRetryItem(null)}
        open={retryItem !== null}
        title="Retry this dead-lettered request?"
      >
        {retryMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(retryMutation.error)}
          </div>
        ) : null}
        <p>
          This command is idempotent and server-authorized. It does not erase the exhausted
          attempts.
        </p>
      </Dialog>
    </AppShell>
  );
}

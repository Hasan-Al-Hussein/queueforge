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
import {
  automaticTryLabel,
  failureExplanation,
  queueDisplayName,
  requestTypeDisplayName,
} from './processing-presentation';

function QueueRow({ queue }: { readonly queue: QueueSnapshot }): React.JSX.Element {
  if (!queue.telemetryAvailable) {
    return (
      <div className="qf-queue-row qf-queue-row--tenant">
        <div>
          <strong>{queueDisplayName(queue.name)}</strong>
          <span>Accepted work</span>
          <details className="qf-advanced-disclosure">
            <summary>Technical name</summary>
            <code>{queue.name}</code>
          </details>
        </div>
        <div className="qf-queue-row__outbox">
          <span>Waiting to start</span>
          <strong>
            {String(queue.outboxBacklog)} ready · {String(queue.outboxDead)} need help
          </strong>
        </div>
      </div>
    );
  }

  const total = queue.waiting + queue.active + queue.delayed + queue.failed;
  const workerLabel =
    queue.workerState === 'offline'
      ? 'not responding'
      : queue.workerState === 'draining'
        ? 'finishing current work'
        : queue.paused
          ? 'paused'
          : 'available';
  return (
    <div className="qf-queue-row">
      <div>
        <strong>{queueDisplayName(queue.name)}</strong>
        <span>Work type</span>
        <details className="qf-advanced-disclosure">
          <summary>Technical name</summary>
          <code>{queue.name}</code>
        </details>
      </div>
      <div>
        <span>Awaiting start</span>
        <strong>{queue.waiting}</strong>
      </div>
      <div>
        <span>Running now</span>
        <strong>{queue.active}</strong>
      </div>
      <div>
        <span>Retrying later</span>
        <strong>{queue.delayed}</strong>
      </div>
      <div>
        <span>Stopped</span>
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
        <span>Background processor</span>
        <strong>
          {String(queue.workerCount)} processor{queue.workerCount === 1 ? '' : 's'} · {workerLabel}
        </strong>
        <small>
          {queue.heartbeatAt === null ? (
            'No recent check-in'
          ) : (
            <>
              Last check-in <DateTime value={queue.heartbeatAt} />
            </>
          )}
        </small>
      </div>
      <div className="qf-queue-row__outbox">
        <span>Accepted work not yet started</span>
        <strong>
          {String(queue.outboxBacklog)} ready · {String(queue.outboxDead)} need help
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
      notify('The request has been queued for another try.', 'success');
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
      header: 'Request type',
      cell: ({ row }) => (
        <div>
          <Link
            className="qf-table-link"
            href={`/requests/detail?id=${encodeURIComponent(row.original.requestId)}`}
            prefetch={false}
          >
            {requestTypeDisplayName(row.original.workflowName)}
          </Link>
          <details className="qf-advanced-disclosure">
            <summary>Technical details</summary>
            <div>
              Stored request type: <code>{row.original.workflowName}</code>
            </div>
            <div>
              Request reference: <CompactId value={row.original.requestId} />
            </div>
          </details>
        </div>
      ),
    },
    {
      accessorKey: 'reason',
      header: 'What happened',
      cell: ({ getValue }) => (
        <div className="qf-wrap-cell">
          <span>{failureExplanation(String(getValue()))}</span>
          <details className="qf-advanced-disclosure">
            <summary>Technical reason</summary>
            <code>{String(getValue())}</code>
          </details>
        </div>
      ),
    },
    {
      accessorKey: 'attemptCount',
      header: 'Automatic tries',
      cell: ({ getValue }) => automaticTryLabel(Number(getValue())),
    },
    {
      accessorKey: 'deadLetteredAt',
      header: 'Stopped at',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
    {
      id: 'retry',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => (
        <PermissionGate permission="retry">
          <Button
            disabled={!online}
            icon={<RotateCcw size={15} />}
            onClick={() => setRetryItem(row.original)}
            tone="quiet"
          >
            Try again
          </Button>
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
        description="See what QueueForge is working on and help requests that could not finish automatically."
        eyebrow="Keep work moving"
        title="Processing health"
      />
      <MetricStrip
        items={
          telemetryAvailable
            ? [
                { label: 'Waiting to start', value: totals.waiting, detail: 'Ready to process' },
                { label: 'Running now', value: totals.active, detail: 'Currently processing' },
                {
                  label: 'Retrying later',
                  value: totals.delayed,
                  detail: 'Automatic retry scheduled',
                },
                { label: 'Stopped', value: totals.failed, detail: 'Processing jobs that stopped' },
                {
                  label: 'Accepted work',
                  value: totals.outboxBacklog,
                  detail: 'Saved safely and waiting to start',
                },
                {
                  label: 'Handoff problems',
                  value: totals.outboxDead,
                  detail: 'Could not reach a processor',
                },
              ]
            : [
                {
                  label: 'Accepted work',
                  value: totals.outboxBacklog,
                  detail: 'Saved safely and waiting to start',
                },
                {
                  label: 'Handoff problems',
                  value: totals.outboxDead,
                  detail: 'Could not reach a processor',
                },
              ]
        }
      />
      <div className="qf-content-grid">
        <Panel
          title="What QueueForge is processing"
          description={
            telemetryAvailable
              ? 'Live processor information refreshes every 15 seconds.'
              : 'This workspace shows accepted work that is waiting to start. Platform admins can also see live processor details.'
          }
          actions={
            <span className="qf-save-state">
              <Activity size={15} />
              {telemetryAvailable ? 'Updates automatically' : 'This workspace only'}
            </span>
          }
        >
          <QueryState
            empty={queuesQuery.isSuccess && queueRows.length === 0}
            emptyDescription="QueueForge has not reported any processing activity yet."
            emptyTitle="No processing activity"
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
          title="Needs attention"
          description="These requests used every automatic try. Review what happened before trying again."
        >
          <QueryState
            empty={deadLettersQuery.isSuccess && deadLetters.length === 0}
            emptyDescription="Every request has finished or still has an automatic try available."
            emptyTitle="Nothing needs help"
            error={deadLettersQuery.error}
            isLoading={deadLettersQuery.isLoading}
            onRetry={() => void deadLettersQuery.refetch()}
          >
            <DataTable
              ariaLabel="Requests that need attention"
              columns={columns}
              getRowId={(row) => row.id}
              rows={deadLetters}
              search={{
                label: 'Search requests that need attention',
                placeholder: 'Request type, reference, or reason',
                text: (row) => `${row.workflowName} ${row.requestId} ${row.reason}`,
              }}
            />
          </QueryState>
          {deadLettersQuery.data?.meta === undefined ? null : (
            <PaginationControls
              ariaLabel="Requests that need attention"
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
        description="QueueForge will keep the earlier failure history and start a fresh processing try."
        footer={
          <>
            <Button onClick={() => setRetryItem(null)}>Cancel</Button>
            <Button
              disabled={!online}
              loading={retryMutation.isPending}
              loadingLabel="Queueing another try"
              onClick={() => {
                if (retryItem !== null) retryMutation.mutate(retryItem);
              }}
              tone="primary"
            >
              Try processing again
            </Button>
          </>
        }
        onClose={() => setRetryItem(null)}
        open={retryItem !== null}
        title="Try processing this request again?"
      >
        {retryMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(retryMutation.error)}
          </div>
        ) : null}
        <p>Earlier attempts remain visible, so the complete history is never lost.</p>
        <details className="qf-advanced-disclosure">
          <summary>Technical behavior</summary>
          <p>
            The server authorizes this idempotent command and returns the request to the processing
            queue without deleting exhausted attempts.
          </p>
        </details>
      </Dialog>
    </AppShell>
  );
}

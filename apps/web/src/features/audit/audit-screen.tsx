'use client';

import { useDeferredValue, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, FileLock2, Panel, RefreshCw } from '@queueforge/ui';

import { apiRequest } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { PagedAuditSchema, type AuditEvent } from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { activityPresentation, formattedTechnicalSummary } from './activity-presentation';

const ACTIVITY_FILTERS = [
  { label: 'All activity', value: '' },
  { label: 'Requests', value: 'request.' },
  { label: 'Approvals', value: 'approval.' },
  { label: 'Recovery actions', value: 'dead_letter.' },
  { label: 'Integrations', value: 'webhook.' },
  { label: 'Notifications', value: 'notification.' },
  { label: 'Request types', value: 'workflow.' },
  { label: 'Team access', value: 'membership.' },
  { label: 'Workspace changes', value: 'tenant.' },
  { label: 'Sign-ins and security', value: 'auth.' },
  { label: 'API access', value: 'api_client.' },
] as const;

const columns: readonly ColumnDef<AuditEvent, unknown>[] = [
  {
    accessorKey: 'occurredAt',
    header: 'When',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
  {
    accessorKey: 'eventType',
    header: 'Activity',
    cell: ({ row }) => {
      const presentation = activityPresentation(row.original);
      return (
        <div>
          <strong>{presentation.action}</strong>
          <div className="qf-utility">
            {presentation.category} · {presentation.resource}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: 'actorName',
    header: 'Done by',
    cell: ({ getValue }) => (getValue() === null ? 'QueueForge automatically' : String(getValue())),
  },
  {
    accessorKey: 'summary',
    header: 'What happened',
    cell: ({ row }) => (
      <span className="qf-wrap-cell">{activityPresentation(row.original).summary}</span>
    ),
  },
  {
    id: 'details',
    header: 'Details',
    enableSorting: false,
    cell: ({ row }) => (
      <details className="qf-advanced-disclosure">
        <summary>View</summary>
        <dl className="qf-key-values">
          <dt>Event code</dt>
          <dd>
            <code>{row.original.eventType}</code>
          </dd>
          <dt>Resource type</dt>
          <dd>
            <code>{row.original.resourceType}</code>
          </dd>
          {row.original.resourceId === null ? null : (
            <>
              <dt>Resource reference</dt>
              <dd>
                <CompactId value={row.original.resourceId} />
              </dd>
            </>
          )}
          <dt>Trace reference</dt>
          <dd>
            <CompactId value={row.original.correlationId} />
          </dd>
        </dl>
        <pre className="qf-code-block qf-code-block--compact">
          {formattedTechnicalSummary(row.original.summary)}
        </pre>
      </details>
    ),
  },
];

export function AuditScreen(): React.JSX.Element {
  const pagination = usePagination();
  const [eventType, setEventType] = useState('');
  const deferredEventType = useDeferredValue(eventType.trim());
  const auditQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['audit', deferredEventType, pagination.page, pagination.pageSize],
    queryFn: ({ signal }) => {
      const query = pageSearchParams(pagination);
      if (deferredEventType !== '') query.set('eventType', deferredEventType);
      return apiRequest(`${routes.audit}?${query.toString()}`, {
        schema: PagedAuditSchema,
        signal,
      });
    },
  });
  const rows = auditQuery.data?.items ?? [];

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={auditQuery.isFetching}
            onClick={() => void auditQuery.refetch()}
          >
            Refresh
          </Button>
        }
        description="See actions taken by people and automatic work completed by QueueForge."
        eyebrow="A clear record of changes"
        title="Activity log"
      />
      <div className="qf-inline-alert" role="note">
        <FileLock2 size={18} />
        <p>
          This history cannot be edited or deleted during normal operation. Open Details only when
          you need technical references for support or investigation.
        </p>
      </div>
      <Panel>
        <div className="qf-toolbar">
          <div className="qf-inline-field">
            <label htmlFor="audit-event-filter">Show activity for</label>
            <select
              id="audit-event-filter"
              onChange={(event) => {
                pagination.resetPage();
                setEventType(event.currentTarget.value);
              }}
              value={eventType}
            >
              {ACTIVITY_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="qf-utility">Technical codes stay hidden until you open Details.</p>
        </div>
        <QueryState
          empty={auditQuery.isSuccess && rows.length === 0}
          emptyDescription="No recorded activity matches this category in the current workspace."
          emptyTitle="No matching activity"
          error={auditQuery.error}
          isLoading={auditQuery.isLoading}
          onRetry={() => void auditQuery.refetch()}
        >
          <DataTable
            ariaLabel="Workspace activity log"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            search={{
              label: 'Search activity on this page',
              placeholder: 'Action, person, or technical reference',
              text: (row) => {
                const presentation = activityPresentation(row);
                return `${presentation.action} ${presentation.summary} ${row.eventType} ${row.actorName ?? 'QueueForge'} ${row.summary} ${row.correlationId}`;
              },
            }}
          />
        </QueryState>
        {auditQuery.data?.meta === undefined ? null : (
          <PaginationControls
            ariaLabel="Activity log"
            disabled={auditQuery.isFetching}
            meta={auditQuery.data.meta}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            page={pagination.page}
            pageSize={pagination.pageSize}
          />
        )}
      </Panel>
    </AppShell>
  );
}

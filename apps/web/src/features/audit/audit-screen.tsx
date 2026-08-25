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

const columns: readonly ColumnDef<AuditEvent, unknown>[] = [
  {
    accessorKey: 'occurredAt',
    header: 'Time',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
  {
    accessorKey: 'eventType',
    header: 'Event',
    cell: ({ getValue }) => <code>{String(getValue())}</code>,
  },
  {
    accessorKey: 'actorName',
    header: 'Actor',
    cell: ({ getValue }) => (getValue() === null ? 'System' : String(getValue())),
  },
  {
    accessorKey: 'summary',
    header: 'Summary',
    cell: ({ getValue }) => <span className="qf-wrap-cell">{String(getValue())}</span>,
  },
  {
    accessorKey: 'resourceType',
    header: 'Resource',
    cell: ({ row }) => (
      <div>
        {row.original.resourceType}
        {row.original.resourceId === null ? null : (
          <div>
            <CompactId value={row.original.resourceId} />
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: 'correlationId',
    header: 'Correlation',
    cell: ({ getValue }) => <CompactId value={String(getValue())} />,
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
        description="See who did what, when it happened, and how each request moved through the system."
        eyebrow="Complete traceability"
        title="Activity history"
      />
      <div className="qf-inline-alert" role="note">
        <FileLock2 size={18} />
        <p>
          Runtime database roles cannot update, delete, or truncate audit records. Metadata is
          bounded and redacted; this is append-only integrity, not cryptographic immutability.
        </p>
      </div>
      <Panel>
        <div className="qf-toolbar">
          <div className="qf-inline-field">
            <label htmlFor="audit-event-filter">Event type prefix</label>
            <input
              className="qf-input"
              id="audit-event-filter"
              onChange={(event) => {
                pagination.resetPage();
                setEventType(event.currentTarget.value);
              }}
              placeholder="request. or webhook."
              value={eventType}
            />
          </div>
          <p className="qf-utility">Filters are validated and allowlisted by the server.</p>
        </div>
        <QueryState
          empty={auditQuery.isSuccess && rows.length === 0}
          emptyDescription="No audit event matches this tenant and event filter."
          emptyTitle="No matching audit evidence"
          error={auditQuery.error}
          isLoading={auditQuery.isLoading}
          onRetry={() => void auditQuery.refetch()}
        >
          <DataTable
            ariaLabel="Tenant audit events"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            search={{
              label: 'Search audit trail',
              placeholder: 'Event, actor, summary, or correlation',
              text: (row) =>
                `${row.eventType} ${row.actorName ?? 'system'} ${row.summary} ${row.correlationId}`,
            }}
          />
        </QueryState>
        {auditQuery.data?.meta === undefined ? null : (
          <PaginationControls
            ariaLabel="Audit events"
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

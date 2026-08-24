'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  SubmitWorkflowRequestSchema,
  WorkflowRequestViewSchema,
  type WorkflowRequestView,
} from '@queueforge/contracts';
import {
  Button,
  Dialog,
  InputField,
  Panel,
  Plus,
  RefreshCw,
  Send,
  StatusBadge,
  TextareaField,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { PagedRequestsSchema } from '../../domain/models';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

const SubmitFormSchema = z.object({
  workflowKey: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, numbers, underscores, or dashes.'),
  payloadText: z.string().min(2, 'Enter a JSON object.'),
});
type SubmitForm = z.infer<typeof SubmitFormSchema>;

export type RequestSortBy = 'submittedAt' | 'workflowName' | 'status' | 'source' | 'attemptCount';
export type RequestSortDirection = 'asc' | 'desc';

const DEFAULT_REQUEST_SORT = {
  sortBy: 'submittedAt',
  sortDirection: 'desc',
} as const satisfies {
  readonly sortBy: RequestSortBy;
  readonly sortDirection: RequestSortDirection;
};
const REQUEST_SORT_FIELDS: ReadonlySet<string> = new Set<RequestSortBy>([
  'submittedAt',
  'workflowName',
  'status',
  'source',
  'attemptCount',
]);

export function requestListSearchParams({
  page,
  pageSize,
  search,
  sortBy,
  sortDirection,
  status,
}: {
  readonly page: number;
  readonly pageSize: number;
  readonly search: string;
  readonly sortBy: RequestSortBy;
  readonly sortDirection: RequestSortDirection;
  readonly status: string;
}): URLSearchParams {
  const query = pageSearchParams({ page, pageSize });
  const normalizedSearch = search.trim().slice(0, 160);
  if (normalizedSearch !== '') query.set('search', normalizedSearch);
  query.set('sortBy', sortBy);
  query.set('sortDirection', sortDirection);
  if (status !== 'all') query.set('status', status);
  return query;
}

export function requestSortFromTable(sorting: SortingState): {
  readonly sortBy: RequestSortBy;
  readonly sortDirection: RequestSortDirection;
} {
  const primary = sorting[0];
  if (primary === undefined || !REQUEST_SORT_FIELDS.has(primary.id)) return DEFAULT_REQUEST_SORT;
  return {
    sortBy: primary.id as RequestSortBy,
    sortDirection: primary.desc ? 'desc' : 'asc',
  };
}

const requestColumns: readonly ColumnDef<WorkflowRequestView, unknown>[] = [
  {
    accessorKey: 'workflowName',
    header: 'Workflow',
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
    accessorKey: 'versionNo',
    enableSorting: false,
    header: 'Version',
    cell: ({ getValue }) => <span className="qf-mono">v{String(getValue())}</span>,
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
    accessorKey: 'submittedAt',
    header: 'Submitted',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
];

export function RequestsScreen(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<RequestSortBy>(DEFAULT_REQUEST_SORT.sortBy);
  const [sortDirection, setSortDirection] = useState<RequestSortDirection>(
    DEFAULT_REQUEST_SORT.sortDirection,
  );
  const pagination = usePagination();
  const router = useRouter();
  const [submitOpen, setSubmitOpen] = useState(false);
  const queryClient = useQueryClient();
  const { online } = useAuth();
  const { notify } = useToast();
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const requestsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: [
      'requests',
      statusFilter,
      search,
      sortBy,
      sortDirection,
      pagination.page,
      pagination.pageSize,
    ],
    queryFn: ({ signal }) => {
      const query = requestListSearchParams({
        ...pagination,
        search,
        sortBy,
        sortDirection,
        status: statusFilter,
      });
      return apiRequest(`${routes.requests}?${query.toString()}`, {
        schema: PagedRequestsSchema,
        signal,
      });
    },
  });
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setError,
  } = useForm<SubmitForm>({
    defaultValues: { payloadText: '{\n  "amount": 1250,\n  "currency": "AED"\n}', workflowKey: '' },
    mode: 'onBlur',
    resolver: zodResolver(SubmitFormSchema),
  });
  const submissionInput = useWatch({ control });
  const submissionKey = useIdempotencyKeyLease(JSON.stringify(submissionInput));
  const submitMutation = useMutation({
    mutationFn: (input: z.infer<typeof SubmitWorkflowRequestSchema>) =>
      apiRequest(routes.requests, {
        body: input,
        idempotencyKey: submissionKey.acquire(),
        method: 'POST',
        schema: WorkflowRequestViewSchema,
      }),
    onSuccess: async (request) => {
      submissionKey.clear();
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      notify('Request accepted and committed.', 'success');
      setSubmitOpen(false);
      reset();
      router.push(`/requests/detail?id=${encodeURIComponent(request.id)}`);
    },
  });

  const submit = handleSubmit(async (values) => {
    let payload: unknown;
    try {
      payload = JSON.parse(values.payloadText) as unknown;
    } catch {
      setError('payloadText', { message: 'Payload must be valid JSON.' }, { shouldFocus: true });
      return;
    }
    const parsed = SubmitWorkflowRequestSchema.safeParse({
      payload,
      workflowKey: values.workflowKey,
    });
    if (!parsed.success) {
      setError(
        'payloadText',
        { message: parsed.error.issues[0]?.message ?? 'Payload must be a JSON object.' },
        { shouldFocus: true },
      );
      return;
    }
    await submitMutation.mutateAsync(parsed.data);
  });
  const cancelSubmission = (): void => {
    submissionKey.clear();
    submitMutation.reset();
    setSubmitOpen(false);
  };

  const rows = requestsQuery.data?.items ?? [];
  const sorting = useMemo<SortingState>(
    () => [{ desc: sortDirection === 'desc', id: sortBy }],
    [sortBy, sortDirection],
  );
  const handleSortingChange = (next: SortingState): void => {
    const sort = requestSortFromTable(next);
    pagination.resetPage();
    setSortBy(sort.sortBy);
    setSortDirection(sort.sortDirection);
  };
  const statusOptions = useMemo(
    () => [
      'all',
      'pending_approval',
      'queued',
      'processing',
      'succeeded',
      'failed',
      'dead_lettered',
      'cancelled',
    ],
    [],
  );

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw size={16} />}
              loading={requestsQuery.isFetching}
              onClick={() => void requestsQuery.refetch()}
            >
              Refresh
            </Button>
            <PermissionGate permission="submit">
              <Button
                disabled={!online}
                icon={<Plus size={16} />}
                onClick={() => setSubmitOpen(true)}
                tone="primary"
              >
                Submit request
              </Button>
            </PermissionGate>
          </>
        }
        description="Inspect immutable workflow-version bindings, attempts, and current execution state."
        eyebrow="Workflow intake"
        title="Requests"
      />
      <Panel>
        <div className="qf-toolbar">
          <div className="qf-inline-field">
            <label htmlFor="request-status-filter">Status</label>
            <select
              id="request-status-filter"
              onChange={(event) => {
                pagination.resetPage();
                setStatusFilter(event.currentTarget.value);
              }}
              value={statusFilter}
            >
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <p className="qf-utility">
            Server-scoped to the selected tenant · search and sort cover every matching request
          </p>
        </div>
        <QueryState
          empty={requestsQuery.isSuccess && rows.length === 0}
          emptyAction={
            <PermissionGate permission="submit">
              <Button icon={<Send size={16} />} onClick={() => setSubmitOpen(true)}>
                Submit the first request
              </Button>
            </PermissionGate>
          }
          emptyDescription="No requests match this filter. Change the status filter or submit synthetic work."
          error={requestsQuery.error}
          isLoading={requestsQuery.isLoading}
          onRetry={() => void requestsQuery.refetch()}
        >
          <DataTable
            ariaLabel="Workflow requests"
            columns={requestColumns}
            getRowId={(row) => row.id}
            rows={rows}
            search={{
              label: 'Search requests',
              maxLength: 160,
              onChange: (value) => {
                pagination.resetPage();
                setSearchInput(value.slice(0, 160));
              },
              pending: requestsQuery.isFetching || searchInput.trim() !== search,
              placeholder: 'Workflow, status, source, or ID',
              totalRows: requestsQuery.data?.meta.totalItems,
              value: searchInput,
            }}
            sorting={{ onChange: handleSortingChange, state: sorting }}
          />
        </QueryState>
        {requestsQuery.data?.meta === undefined ? null : (
          <PaginationControls
            ariaLabel="Requests"
            disabled={requestsQuery.isFetching}
            meta={requestsQuery.data.meta}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            page={pagination.page}
            pageSize={pagination.pageSize}
          />
        )}
      </Panel>

      <Dialog
        description="The active workflow version is captured when this command commits."
        footer={
          <>
            <Button onClick={cancelSubmission}>Cancel</Button>
            <Button
              disabled={!online}
              loading={isSubmitting || submitMutation.isPending}
              loadingLabel="Submitting"
              onClick={() => void submit()}
              tone="primary"
            >
              Submit request
            </Button>
          </>
        }
        onClose={cancelSubmission}
        open={submitOpen}
        title="Submit workflow request"
      >
        {submitMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(submitMutation.error)}
          </div>
        ) : null}
        <form className="qf-form-stack" onSubmit={(event) => void submit(event)} noValidate>
          <InputField
            error={errors.workflowKey?.message}
            helper="Stable key of an active workflow, for example expense_review."
            id="submit-workflow-key"
            label="Workflow key"
            required
            {...register('workflowKey')}
          />
          <TextareaField
            error={errors.payloadText?.message}
            helper="A JSON object validated against the active workflow schema."
            id="submit-payload"
            label="Payload JSON"
            required
            spellCheck={false}
            {...register('payloadText')}
          />
        </form>
      </Dialog>
    </AppShell>
  );
}

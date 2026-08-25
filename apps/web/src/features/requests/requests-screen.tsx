'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef, SortingState } from '@tanstack/react-table';

import {
  SubmitWorkflowRequestSchema,
  WorkflowRequestViewSchema,
  type JsonObject,
  type SubmitWorkflowRequest,
  type WorkflowSummary,
  type WorkflowRequestView,
} from '@queueforge/contracts';
import { Button, Dialog, Panel, Plus, RefreshCw, Send, StatusBadge } from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { GuidedRequestForm } from '../../components/guided-request-form';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { buildWorkflowPayload, readWorkflowSchema } from '../../components/workflow-schema';
import { PagedRequestsSchema, WorkflowDetailSchema, WorkflowListSchema } from '../../domain/models';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

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
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [payloadValues, setPayloadValues] = useState<Record<string, unknown>>({});
  const [payloadErrors, setPayloadErrors] = useState<Readonly<Record<string, string>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [advancedPayloadText, setAdvancedPayloadText] = useState('{}');
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
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: ({ signal }) => apiRequest(routes.workflows, { schema: WorkflowListSchema, signal }),
  });
  const selectableWorkflows = useMemo(
    () =>
      (workflowsQuery.data ?? []).filter(
        (workflow) => workflow.versionStatus === 'active' && workflow.isEnabled,
      ),
    [workflowsQuery.data],
  );
  const selectedWorkflow: WorkflowSummary | undefined = selectableWorkflows.find(
    (workflow) => workflow.id === selectedWorkflowId,
  );
  const workflowDetailQuery = useQuery({
    enabled: submitOpen && selectedWorkflowId !== '',
    queryKey: ['workflow', selectedWorkflowId],
    queryFn: ({ signal }) =>
      apiRequest(routes.workflow(selectedWorkflowId), { schema: WorkflowDetailSchema, signal }),
  });
  const guidedSchema = useMemo(
    () =>
      workflowDetailQuery.data === undefined
        ? null
        : readWorkflowSchema(workflowDetailQuery.data.requestSchema),
    [workflowDetailQuery.data],
  );
  const submissionInput = {
    payload: payloadValues,
    workflowKey: selectedWorkflow?.stableKey ?? '',
  };
  const submissionKey = useIdempotencyKeyLease(JSON.stringify(submissionInput));
  const submitMutation = useMutation({
    mutationFn: (input: SubmitWorkflowRequest) =>
      apiRequest(routes.requests, {
        body: input,
        idempotencyKey: submissionKey.acquire(),
        method: 'POST',
        schema: WorkflowRequestViewSchema,
      }),
    onSuccess: async (request) => {
      submissionKey.clear();
      await queryClient.invalidateQueries({ queryKey: ['requests'] });
      notify('Request submitted. QueueForge will keep you updated.', 'success');
      setSubmitOpen(false);
      setSelectedWorkflowId('');
      setPayloadValues({});
      setPayloadErrors({});
      router.push(`/requests/detail?id=${encodeURIComponent(request.id)}`);
    },
  });

  const submit = async (): Promise<void> => {
    setSubmissionError(null);
    if (selectedWorkflow === undefined || guidedSchema === null) {
      setSubmissionError('Choose an active workflow to continue.');
      return;
    }
    let payload: JsonObject | undefined;
    if (guidedSchema.supported) {
      const result = buildWorkflowPayload(guidedSchema.fields, payloadValues);
      setPayloadErrors(result.errors);
      payload = result.payload;
      if (payload === undefined) return;
    } else {
      try {
        const parsedAdvanced = JSON.parse(advancedPayloadText) as unknown;
        if (
          typeof parsedAdvanced !== 'object' ||
          parsedAdvanced === null ||
          Array.isArray(parsedAdvanced)
        ) {
          throw new Error('not an object');
        }
        payload = parsedAdvanced as JsonObject;
      } catch {
        setSubmissionError('Advanced request data must be a valid JSON object.');
        return;
      }
    }
    const parsed = SubmitWorkflowRequestSchema.safeParse({
      payload,
      workflowKey: selectedWorkflow.stableKey,
    });
    if (!parsed.success) {
      setSubmissionError(parsed.error.issues[0]?.message ?? 'Check the request information.');
      return;
    }
    await submitMutation.mutateAsync(parsed.data);
  };
  const cancelSubmission = (): void => {
    submissionKey.clear();
    submitMutation.reset();
    setSubmitOpen(false);
    setSelectedWorkflowId('');
    setPayloadValues({});
    setPayloadErrors({});
    setSubmissionError(null);
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
        description="Start work, follow its progress, and see exactly what needs attention."
        eyebrow="Your work"
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
          emptyDescription="No requests match this view. Change the filter or start a new request."
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
        description="Choose what you want QueueForge to do, then answer a few simple questions."
        footer={
          <>
            <Button onClick={cancelSubmission}>Cancel</Button>
            <Button
              disabled={!online || selectedWorkflow === undefined || workflowDetailQuery.isLoading}
              loading={submitMutation.isPending}
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
        title="Start a new request"
      >
        {submissionError !== null || submitMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {submissionError ?? formatProblem(submitMutation.error)}
          </div>
        ) : null}
        <form
          className="qf-form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          noValidate
        >
          <div className="qf-field">
            <label className="qf-field__label" htmlFor="submit-workflow">
              What do you want to do? <span aria-hidden="true">*</span>
            </label>
            <select
              className="qf-input qf-input--large"
              disabled={workflowsQuery.isLoading}
              id="submit-workflow"
              onChange={(event) => {
                setSelectedWorkflowId(event.currentTarget.value);
                setPayloadValues({});
                setPayloadErrors({});
                setSubmissionError(null);
                submissionKey.clear();
              }}
              value={selectedWorkflowId}
            >
              <option value="">Choose a workflow</option>
              {selectableWorkflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                </option>
              ))}
            </select>
            <p className="qf-field__message">
              {workflowsQuery.isLoading
                ? 'Loading available workflows…'
                : selectableWorkflows.length === 0
                  ? 'No active workflows are accepting requests.'
                  : 'Only active workflows that accept new requests are shown.'}
            </p>
          </div>
          {selectedWorkflow === undefined ? (
            <div className="qf-guidance-card">
              <strong>Start by choosing a workflow</strong>
              <p>
                QueueForge will show the right form automatically—no JSON or workflow key needed.
              </p>
            </div>
          ) : (
            <div className="qf-workflow-choice-summary">
              <div>
                <span>Selected workflow</span>
                <strong>{selectedWorkflow.name}</strong>
                <p>{selectedWorkflow.description ?? 'No description provided.'}</p>
              </div>
              <span className="qf-route-chip">
                {selectedWorkflow.requiresApproval ? 'Approval required' : 'Runs automatically'}
              </span>
            </div>
          )}
          {workflowDetailQuery.isLoading ? (
            <div className="qf-form-skeleton" aria-label="Loading request form" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : guidedSchema?.supported === true ? (
            <GuidedRequestForm
              errors={payloadErrors}
              fields={guidedSchema.fields}
              onChange={(key, value) => {
                setPayloadValues((current) => ({ ...current, [key]: value }));
                setPayloadErrors((current) => {
                  const next = { ...current };
                  delete next[key];
                  return next;
                });
              }}
              values={payloadValues}
            />
          ) : guidedSchema === null ? null : (
            <details className="qf-advanced-disclosure" open>
              <summary>This workflow uses an advanced form</summary>
              <p>
                {guidedSchema.reason} Ask an administrator to simplify it, or enter advanced data
                below.
              </p>
              <label className="qf-field">
                <span className="qf-field__label">Advanced request data (JSON)</span>
                <textarea
                  className="qf-input qf-json-editor"
                  onChange={(event) => setAdvancedPayloadText(event.currentTarget.value)}
                  spellCheck={false}
                  value={advancedPayloadText}
                />
              </label>
            </details>
          )}
        </form>
      </Dialog>
    </AppShell>
  );
}

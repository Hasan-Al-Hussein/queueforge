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
import {
  Button,
  Dialog,
  Panel,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { GuidedRequestForm } from '../../components/guided-request-form';
import { InlineLoadError } from '../../components/inline-load-error';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { buildWorkflowPayload, readWorkflowSchema } from '../../components/workflow-schema';
import { PagedRequestsSchema, WorkflowDetailSchema, WorkflowListSchema } from '../../domain/models';
import {
  isSystemCheckWorkflow,
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTypeLabel,
} from '../../domain/presentation';
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

export function guidedRequestFormReady({
  detailError,
  hasDetails,
  hasSelection,
  isDetailLoading,
  isListLoading,
  listError,
  supported,
}: {
  readonly detailError: unknown;
  readonly hasDetails: boolean;
  readonly hasSelection: boolean;
  readonly isDetailLoading: boolean;
  readonly isListLoading: boolean;
  readonly listError: unknown;
  readonly supported: boolean;
}): boolean {
  return (
    hasSelection &&
    hasDetails &&
    supported &&
    !isDetailLoading &&
    !isListLoading &&
    (detailError === null || detailError === undefined) &&
    (listError === null || listError === undefined)
  );
}

const requestColumns: readonly ColumnDef<WorkflowRequestView, unknown>[] = [
  {
    accessorKey: 'workflowName',
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
  const [showSystemCheckWorkflows, setShowSystemCheckWorkflows] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [payloadValues, setPayloadValues] = useState<Record<string, unknown>>({});
  const [payloadErrors, setPayloadErrors] = useState<Readonly<Record<string, string>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { can, online } = useAuth();
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
  const activeWorkflows = useMemo(
    () =>
      (workflowsQuery.data ?? []).filter(
        (workflow) => workflow.versionStatus === 'active' && workflow.isEnabled,
      ),
    [workflowsQuery.data],
  );
  const systemCheckWorkflowCount = useMemo(
    () => activeWorkflows.filter((workflow) => isSystemCheckWorkflow(workflow)).length,
    [activeWorkflows],
  );
  const selectableWorkflows = useMemo(
    () =>
      showSystemCheckWorkflows
        ? activeWorkflows
        : activeWorkflows.filter((workflow) => !isSystemCheckWorkflow(workflow)),
    [activeWorkflows, showSystemCheckWorkflows],
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
  const requestFormReady = guidedRequestFormReady({
    detailError: workflowDetailQuery.error,
    hasDetails: workflowDetailQuery.data !== undefined,
    hasSelection: selectedWorkflow !== undefined,
    isDetailLoading: workflowDetailQuery.isLoading,
    isListLoading: workflowsQuery.isLoading,
    listError: workflowsQuery.error,
    supported: guidedSchema?.supported === true,
  });
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
      setShowSystemCheckWorkflows(false);
      setSelectedWorkflowId('');
      setPayloadValues({});
      setPayloadErrors({});
      router.push(`/requests/detail?id=${encodeURIComponent(request.id)}`);
    },
  });

  const submit = async (): Promise<void> => {
    setSubmissionError(null);
    if (selectedWorkflow === undefined || guidedSchema === null) {
      setSubmissionError('Choose an available request type to continue.');
      return;
    }
    if (!guidedSchema.supported) {
      setSubmissionError(
        'This request type is not ready for the simple form yet. Ask an administrator to update its questions.',
      );
      return;
    }
    if (!requestFormReady) {
      setSubmissionError('Wait for the request form to finish loading successfully.');
      return;
    }
    const result = buildWorkflowPayload(guidedSchema.fields, payloadValues);
    setPayloadErrors(result.errors);
    const payload: JsonObject | undefined = result.payload;
    if (payload === undefined) return;
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
    setShowSystemCheckWorkflows(false);
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
                Start request
              </Button>
            </PermissionGate>
          </>
        }
        description={
          can('submit')
            ? 'Start a request with a simple form, then follow it from approval to completion.'
            : 'Follow request status and progress without changing operational work.'
        }
        eyebrow={can('submit') ? 'Daily work' : 'Read-only history'}
        title={can('submit') ? 'Requests' : 'Request history'}
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
                  {status === 'all'
                    ? 'All statuses'
                    : requestStatusLabel(status as WorkflowRequestView['status'])}
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
                Start the first request
              </Button>
            </PermissionGate>
          }
          emptyDescription="No requests match this view. Change the filter or start a new request."
          error={requestsQuery.error}
          isLoading={requestsQuery.isLoading}
          onRetry={() => void requestsQuery.refetch()}
        >
          <DataTable
            ariaLabel="Requests"
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
              placeholder: 'Request type, status, or reference',
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
              disabled={!online || !requestFormReady}
              loading={submitMutation.isPending}
              loadingLabel="Submitting"
              onClick={() => void submit()}
              tone="primary"
            >
              Start request
            </Button>
          </>
        }
        onClose={cancelSubmission}
        open={submitOpen}
        title="Start a request"
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
          {workflowsQuery.isLoading ? (
            <div className="qf-form-skeleton" aria-label="Loading request types" role="status">
              <span />
              <span />
            </div>
          ) : workflowsQuery.error !== null ? (
            <InlineLoadError
              error={workflowsQuery.error}
              onRetry={() => void workflowsQuery.refetch()}
              retrying={workflowsQuery.isFetching}
              title="Could not load request types"
            />
          ) : selectableWorkflows.length === 0 ? (
            <div className="qf-guidance-card" role="status">
              <strong>No request types are available</strong>
              <p>Ask an administrator to publish a request type before starting new work.</p>
            </div>
          ) : (
            <div className="qf-field">
              <label className="qf-field__label" htmlFor="submit-workflow">
                What kind of request is this? <span aria-hidden="true">*</span>
              </label>
              <select
                className="qf-input qf-input--large"
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
                <option value="">Choose a request type</option>
                {selectableWorkflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
              <p className="qf-field__message">
                Choose the option that best matches what you need.
              </p>
            </div>
          )}
          {systemCheckWorkflowCount === 0 ? null : (
            <details className="qf-advanced-disclosure">
              <summary>System check request types</summary>
              <p>
                Automated recovery tests stay hidden during normal work so they cannot be selected
                by mistake.
              </p>
              <label className="qf-checkbox">
                <input
                  checked={showSystemCheckWorkflows}
                  onChange={(event) => {
                    const show = event.currentTarget.checked;
                    setShowSystemCheckWorkflows(show);
                    if (
                      !show &&
                      selectedWorkflow !== undefined &&
                      isSystemCheckWorkflow(selectedWorkflow)
                    ) {
                      setSelectedWorkflowId('');
                      setPayloadValues({});
                      setPayloadErrors({});
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  Show {String(systemCheckWorkflowCount)} system check request type
                  {systemCheckWorkflowCount === 1 ? '' : 's'}
                </span>
              </label>
            </details>
          )}
          {workflowsQuery.isSuccess &&
          selectableWorkflows.length > 0 &&
          selectedWorkflow === undefined ? (
            <div className="qf-guidance-card">
              <strong>Start by choosing a request type</strong>
              <p>
                QueueForge will show the right questions automatically. You never need to enter JSON
                or a technical key.
              </p>
            </div>
          ) : selectedWorkflow !== undefined ? (
            <div className="qf-workflow-choice-summary">
              <div>
                <span>Selected request type</span>
                <strong>{selectedWorkflow.name}</strong>
                <p>{selectedWorkflow.description ?? 'No description provided.'}</p>
              </div>
              <span className="qf-route-chip">
                {selectedWorkflow.requiresApproval ? 'Approval required' : 'Runs automatically'}
              </span>
            </div>
          ) : null}
          {selectedWorkflow === undefined ? null : workflowDetailQuery.isLoading ? (
            <div className="qf-form-skeleton" aria-label="Loading request form" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : workflowDetailQuery.error !== null ? (
            <InlineLoadError
              error={workflowDetailQuery.error}
              onRetry={() => void workflowDetailQuery.refetch()}
              retrying={workflowDetailQuery.isFetching}
              title="Could not load this request form"
            />
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
            <div className="qf-inline-alert" role="note">
              <ShieldAlert aria-hidden="true" size={18} />
              <div>
                <strong>This request type needs a form update</strong>
                <p>
                  {guidedSchema.reason} An administrator can update its questions in Request types.
                </p>
              </div>
            </div>
          )}
        </form>
      </Dialog>
    </AppShell>
  );
}

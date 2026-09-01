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
  ArrowRight,
  Button,
  Dialog,
  FileClock,
  Panel,
  Plus,
  RefreshCw,
  SelectControl,
  Send,
  ShieldAlert,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { GuidedRequestForm } from '../../components/guided-request-form';
import { HumanReadablePayload } from '../../components/human-readable-payload';
import { InlineLoadError } from '../../components/inline-load-error';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { HeroMetrics, RouteHero } from '../../components/route-hero';
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
import styles from './requests-screen.module.css';

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
const MOBILE_REQUEST_PREVIEW_ROWS = 6;
const EMPTY_REQUEST_ROWS: readonly WorkflowRequestView[] = [];
type SubmissionStep = 0 | 1 | 2;

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
  const pagination = usePagination(10);
  const router = useRouter();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submissionStep, setSubmissionStep] = useState<SubmissionStep>(0);
  const [reviewPayload, setReviewPayload] = useState<JsonObject | null>(null);
  const [showSystemCheckWorkflows, setShowSystemCheckWorkflows] = useState(false);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [payloadValues, setPayloadValues] = useState<Record<string, unknown>>({});
  const [payloadErrors, setPayloadErrors] = useState<Readonly<Record<string, string>>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [showAllMobileRows, setShowAllMobileRows] = useState(false);
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
      setSubmissionStep(0);
      setReviewPayload(null);
      setShowSystemCheckWorkflows(false);
      setSelectedWorkflowId('');
      setPayloadValues({});
      setPayloadErrors({});
      router.push(`/requests/detail?id=${encodeURIComponent(request.id)}`);
    },
  });

  const prepareSubmission = (): JsonObject | null => {
    setSubmissionError(null);
    if (selectedWorkflow === undefined || guidedSchema === null) {
      setSubmissionError('Choose an available request type to continue.');
      return null;
    }
    if (!guidedSchema.supported) {
      setSubmissionError(
        'This request type is not ready for the simple form yet. Ask an administrator to update its questions.',
      );
      return null;
    }
    if (!requestFormReady) {
      setSubmissionError('Wait for the request form to finish loading successfully.');
      return null;
    }
    const result = buildWorkflowPayload(guidedSchema.fields, payloadValues);
    setPayloadErrors(result.errors);
    const payload: JsonObject | undefined = result.payload;
    if (payload === undefined) return null;
    const parsed = SubmitWorkflowRequestSchema.safeParse({
      payload,
      workflowKey: selectedWorkflow.stableKey,
    });
    if (!parsed.success) {
      setSubmissionError(parsed.error.issues[0]?.message ?? 'Check the request information.');
      return null;
    }
    return parsed.data.payload;
  };
  const submit = async (): Promise<void> => {
    const payload = prepareSubmission();
    if (payload === null || selectedWorkflow === undefined) return;
    await submitMutation.mutateAsync({ payload, workflowKey: selectedWorkflow.stableKey });
  };
  const advanceSubmission = (): void => {
    if (submissionStep === 0) {
      if (selectedWorkflow === undefined) {
        setSubmissionError('Choose a request type to continue.');
        return;
      }
      setSubmissionError(null);
      setSubmissionStep(1);
      return;
    }
    if (submissionStep === 1) {
      const payload = prepareSubmission();
      if (payload === null) return;
      setReviewPayload(payload);
      setSubmissionStep(2);
    }
  };
  const cancelSubmission = (): void => {
    submissionKey.clear();
    submitMutation.reset();
    setSubmitOpen(false);
    setSubmissionStep(0);
    setReviewPayload(null);
    setShowSystemCheckWorkflows(false);
    setSelectedWorkflowId('');
    setPayloadValues({});
    setPayloadErrors({});
    setSubmissionError(null);
  };
  const openSubmission = (): void => {
    setSubmissionError(null);
    setReviewPayload(null);
    setSubmissionStep(0);
    setSubmitOpen(true);
  };

  const rows = requestsQuery.data?.items ?? EMPTY_REQUEST_ROWS;
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
  const visibleMobileRows = showAllMobileRows ? rows : rows.slice(0, MOBILE_REQUEST_PREVIEW_ROWS);
  const pageLaneCounts = useMemo(() => {
    const counts = { attention: 0, complete: 0, moving: 0, waiting: 0 };
    for (const request of rows) {
      switch (request.status) {
        case 'pending_approval':
          counts.waiting += 1;
          break;
        case 'approved':
        case 'processing':
        case 'queued':
        case 'received':
          counts.moving += 1;
          break;
        case 'succeeded':
          counts.complete += 1;
          break;
        default:
          counts.attention += 1;
      }
    }
    return counts;
  }, [rows]);

  return (
    <AppShell>
      <RouteHero
        actions={
          <>
            <PermissionGate permission="submit">
              <Button
                disabled={!online}
                icon={<Plus size={16} />}
                onClick={openSubmission}
                tone="primary"
              >
                Start request
              </Button>
            </PermissionGate>
            <Button
              icon={<RefreshCw size={16} />}
              loading={requestsQuery.isFetching}
              onClick={() => void requestsQuery.refetch()}
            >
              Refresh
            </Button>
          </>
        }
        description={
          can('submit')
            ? 'Start new work and track every request through approval, processing, and delivery.'
            : 'Track request status and history without changing operational work.'
        }
        eyebrow={can('submit') ? 'Daily work' : 'Read-only history'}
        icon={<FileClock size={18} />}
        meta={`${online ? 'Live tenant state' : 'Offline view'} · ${String(rows.length)} requests on this page`}
        title={can('submit') ? 'Requests' : 'Request history'}
        visual={
          <HeroMetrics
            items={[
              {
                label: 'Awaiting approval',
                tone: pageLaneCounts.waiting > 0 ? 'warning' : 'role',
                value: requestsQuery.isLoading ? '…' : pageLaneCounts.waiting,
              },
              {
                label: 'In progress',
                tone: pageLaneCounts.moving > 0 ? 'signal' : 'role',
                value: requestsQuery.isLoading ? '…' : pageLaneCounts.moving,
              },
              {
                label: 'Completed',
                value: requestsQuery.isLoading ? '…' : pageLaneCounts.complete,
              },
              {
                label: 'Needs attention',
                tone: pageLaneCounts.attention > 0 ? 'danger' : 'role',
                value: requestsQuery.isLoading ? '…' : pageLaneCounts.attention,
              },
            ]}
          />
        }
      />
      {can('submit') ? (
        <ScrollReveal>
          <section className={styles.quickStart} aria-labelledby="quick-start-title">
            <div>
              <p className="qf-eyebrow">New request</p>
              <h2 id="quick-start-title">What does your team need?</h2>
              <p>Choose a request type. The next screen asks only the questions it needs.</p>
            </div>
            <div className={styles.quickStartControls}>
              <label htmlFor="quick-request-workflow">Request type</label>
              <SelectControl
                disabled={
                  workflowsQuery.isLoading ||
                  workflowsQuery.error !== null ||
                  selectableWorkflows.length === 0
                }
                id="quick-request-workflow"
                onChange={(event) => {
                  setSelectedWorkflowId(event.currentTarget.value);
                  setPayloadValues({});
                  setPayloadErrors({});
                  setReviewPayload(null);
                  setSubmissionError(null);
                  submissionKey.clear();
                }}
                value={selectedWorkflowId}
              >
                <option value="">Choose what you need</option>
                {selectableWorkflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </SelectControl>
              <Button
                disabled={!online || selectedWorkflow === undefined}
                icon={<ArrowRight size={16} />}
                onClick={openSubmission}
                tone="primary"
              >
                Continue
              </Button>
            </div>
          </section>
        </ScrollReveal>
      ) : null}
      <ScrollReveal>
        <Panel
          className={styles.ledgerPanel}
          description="Search every request in this workspace, narrow by status, and open its full history."
          id="request-ledger"
          title="All requests"
        >
          <div className="qf-toolbar">
            <div className="qf-inline-field">
              <label htmlFor="request-status-filter">Status</label>
              <SelectControl
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
              </SelectControl>
            </div>
            <p className="qf-utility">
              Server-scoped to the selected tenant · search and sort cover every matching request
            </p>
          </div>
          <QueryState
            empty={requestsQuery.isSuccess && rows.length === 0}
            emptyAction={
              <PermissionGate permission="submit">
                <Button icon={<Send size={16} />} onClick={openSubmission}>
                  Start the first request
                </Button>
              </PermissionGate>
            }
            emptyDescription="No requests match this view. Change the filter or start a new request."
            error={requestsQuery.error}
            isLoading={requestsQuery.isLoading}
            onRetry={() => void requestsQuery.refetch()}
          >
            <div className={styles.ledger}>
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
              <section className={styles.mobileLedger} aria-label="Request cards">
                {visibleMobileRows.map((request) => (
                  <article className={styles.requestCard} key={request.id}>
                    <div className={styles.cardTopline}>
                      <span className={styles.cardIndex}>Request</span>
                      <StatusBadge
                        status={request.status}
                        label={requestStatusLabel(request.status)}
                      />
                    </div>
                    <Link
                      className={styles.cardTitle}
                      href={`/requests/detail?id=${encodeURIComponent(request.id)}`}
                      prefetch={false}
                    >
                      {requestTypeLabel(request.workflowName)}
                    </Link>
                    <p className={styles.cardProgress}>{requestProgressLabel(request)}</p>
                    <dl className={styles.cardFacts}>
                      <div>
                        <dt>Started from</dt>
                        <dd>{requestSourceLabel(request.source)}</dd>
                      </div>
                      <div>
                        <dt>Submitted</dt>
                        <dd>
                          <DateTime value={request.submittedAt} />
                        </dd>
                      </div>
                    </dl>
                    <Link
                      className={`qf-button qf-button--quiet ${styles.openRequest}`}
                      href={`/requests/detail?id=${encodeURIComponent(request.id)}`}
                      prefetch={false}
                    >
                      <span>Open request</span>
                      <ArrowRight aria-hidden="true" size={16} />
                    </Link>
                  </article>
                ))}
                {rows.length > MOBILE_REQUEST_PREVIEW_ROWS ? (
                  <Button
                    className={styles.showMore}
                    onClick={() => setShowAllMobileRows((current) => !current)}
                    tone="quiet"
                  >
                    {showAllMobileRows
                      ? 'Show fewer requests'
                      : `Show ${String(rows.length - MOBILE_REQUEST_PREVIEW_ROWS)} more on this page`}
                  </Button>
                ) : null}
              </section>
            </div>
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
      </ScrollReveal>

      <Dialog
        description="Choose the request type, add the required details, then review everything before it is sent."
        footer={
          <>
            <Button onClick={cancelSubmission}>Cancel</Button>
            {submissionStep > 0 ? (
              <Button
                onClick={() => {
                  setSubmissionError(null);
                  setSubmissionStep((submissionStep - 1) as SubmissionStep);
                }}
              >
                Back
              </Button>
            ) : null}
            <Button
              disabled={
                !online ||
                (submissionStep === 0 && selectedWorkflow === undefined) ||
                (submissionStep === 1 && !requestFormReady) ||
                (submissionStep === 2 && reviewPayload === null)
              }
              loading={submissionStep === 2 && submitMutation.isPending}
              loadingLabel="Submitting"
              onClick={() => {
                if (submissionStep === 2) void submit();
                else advanceSubmission();
              }}
              tone="primary"
            >
              {submissionStep === 0
                ? 'Continue to details'
                : submissionStep === 1
                  ? 'Review request'
                  : 'Submit request'}
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
        <ol className={styles.requestSteps} aria-label="Request setup steps">
          <li
            aria-current={submissionStep === 0 ? 'step' : undefined}
            data-state={submissionStep === 0 ? 'current' : 'complete'}
          >
            <span>1</span>
            <strong>Choose type</strong>
          </li>
          <li
            aria-current={submissionStep === 1 ? 'step' : undefined}
            data-state={
              submissionStep < 1 ? 'upcoming' : submissionStep === 1 ? 'current' : 'complete'
            }
          >
            <span>2</span>
            <strong>Add details</strong>
          </li>
          <li
            aria-current={submissionStep === 2 ? 'step' : undefined}
            data-state={submissionStep === 2 ? 'current' : 'upcoming'}
          >
            <span>3</span>
            <strong>Review and send</strong>
          </li>
        </ol>
        <form
          className="qf-form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (submissionStep === 2) void submit();
            else advanceSubmission();
          }}
          noValidate
        >
          {submissionStep === 0 ? (
            <div className={styles.stepPanel} data-step="choose">
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
                  <SelectControl
                    className="qf-input--large"
                    id="submit-workflow"
                    onChange={(event) => {
                      setSelectedWorkflowId(event.currentTarget.value);
                      setPayloadValues({});
                      setPayloadErrors({});
                      setReviewPayload(null);
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
                  </SelectControl>
                  <p className="qf-field__message">
                    Choose the option that best matches what you need.
                  </p>
                </div>
              )}
              {systemCheckWorkflowCount === 0 ? null : (
                <details className="qf-advanced-disclosure">
                  <summary>System check request types</summary>
                  <p>
                    Automated recovery tests stay hidden during normal work so they cannot be
                    selected by mistake.
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
                          setReviewPayload(null);
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
                    QueueForge will show the right questions automatically. You never need to enter
                    JSON or a technical key.
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
            </div>
          ) : null}
          {submissionStep === 1 ? (
            <div className={styles.stepPanel} data-step="details">
              <div className={styles.stepLead}>
                <span>Request details</span>
                <strong>{selectedWorkflow?.name ?? 'Selected request type'}</strong>
                <p>Answer the required questions. You can review every answer before sending.</p>
              </div>
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
                    setReviewPayload(null);
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
                      {guidedSchema.reason} An administrator can update its questions in Request
                      types.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {submissionStep === 2 && selectedWorkflow !== undefined && reviewPayload !== null ? (
            <div className={styles.reviewStep}>
              <div className={styles.reviewHeading}>
                <div>
                  <span>Ready to submit</span>
                  <h3>{selectedWorkflow.name}</h3>
                  <p>Check the request and the path it will follow.</p>
                </div>
                <StatusBadge
                  status={selectedWorkflow.requiresApproval ? 'pending' : 'active'}
                  label={
                    selectedWorkflow.requiresApproval ? 'Approval required' : 'Runs automatically'
                  }
                />
              </div>
              <HumanReadablePayload payload={reviewPayload} title="Your answers" />
              <ol className={styles.downstreamPath} aria-label="What happens after submission">
                <li data-state="current">
                  <span>1</span>
                  <div>
                    <strong>Request recorded</strong>
                    <p>
                      QueueForge validates the form and binds this request to the current version.
                    </p>
                  </div>
                </li>
                {selectedWorkflow.requiresApproval ? (
                  <li>
                    <span>2</span>
                    <div>
                      <strong>Approval</strong>
                      <p>An approver reviews the request before processing begins.</p>
                    </div>
                  </li>
                ) : null}
                <li>
                  <span>{selectedWorkflow.requiresApproval ? '3' : '2'}</span>
                  <div>
                    <strong>Processing and delivery</strong>
                    <p>
                      Durable attempts run, and the final outcome stays attached to this request.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          ) : null}
        </form>
      </Dialog>
    </AppShell>
  );
}

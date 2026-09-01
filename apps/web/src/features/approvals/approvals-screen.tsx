'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useForm, useWatch } from 'react-hook-form';

import { ApprovalDecisionInputSchema } from '@queueforge/contracts';
import {
  ArrowRight,
  Button,
  Check,
  ClipboardCheck,
  Dialog,
  InputField,
  Panel,
  RefreshCw,
  Search,
  ShieldAlert,
  StatusBadge,
  TextareaField,
  X,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { DateTime } from '../../components/format';
import { HumanReadablePayload } from '../../components/human-readable-payload';
import { InlineLoadError } from '../../components/inline-load-error';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { HeroMetrics, RouteHero } from '../../components/route-hero';
import { PagedApprovalsSchema, type ApprovalTask } from '../../domain/models';
import { approvalPayloadPreview, requestTypeLabel } from '../../domain/presentation';
import { WorkflowRequestViewSchema } from '@queueforge/contracts';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import styles from './approvals-screen.module.css';

interface DecisionForm {
  readonly note?: string;
}

const EMPTY_APPROVAL_ROWS: readonly ApprovalTask[] = [];
const APPROVAL_FACT_PREVIEW_LIMIT = 44;

function shortenApprovalFact(fact: string): string {
  if (fact.length <= APPROVAL_FACT_PREVIEW_LIMIT) return fact;

  const candidate = fact.slice(0, APPROVAL_FACT_PREVIEW_LIMIT - 1).trimEnd();
  const lastSpace = candidate.lastIndexOf(' ');
  const cutoff =
    lastSpace >= Math.floor(APPROVAL_FACT_PREVIEW_LIMIT * 0.65) ? lastSpace : candidate.length;
  return `${candidate.slice(0, cutoff).replace(/[,:;.\s]+$/u, '')}…`;
}

export function approvalPayloadDigest(payloadSummary: string): string {
  try {
    const parsed = JSON.parse(payloadSummary) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return approvalPayloadPreview(payloadSummary);
    }

    const submitted = parsed as Readonly<Record<string, unknown>>;
    const facts = Object.entries(submitted)
      .slice(0, 3)
      .map(([key, value]) =>
        shortenApprovalFact(approvalPayloadPreview(JSON.stringify({ [key]: value }))),
      );
    return facts.length === 0 ? approvalPayloadPreview(payloadSummary) : facts.join(' · ');
  } catch {
    return approvalPayloadPreview(payloadSummary);
  }
}

export function approvalDecisionDetailsReady({
  error,
  hasDetails,
  isLoading,
}: {
  readonly error: unknown;
  readonly hasDetails: boolean;
  readonly isLoading: boolean;
}): boolean {
  return hasDetails && !isLoading && (error === null || error === undefined);
}

export function approvalMatchesSearch(task: ApprovalTask, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (query === '') return true;
  return `${task.workflowName} ${task.requestedByName} ${task.status} ${task.payloadSummary}`
    .toLowerCase()
    .includes(query);
}

export function prioritizeApprovalsForFocus({
  canApprove,
  currentUserId,
  rows,
}: {
  readonly canApprove: boolean;
  readonly currentUserId: string | undefined;
  readonly rows: readonly ApprovalTask[];
}): readonly ApprovalTask[] {
  const actionable: ApprovalTask[] = [];
  const remainder: ApprovalTask[] = [];
  for (const row of rows) {
    if (row.status === 'pending' && canApprove && currentUserId !== row.requestedById)
      actionable.push(row);
    else remainder.push(row);
  }
  return [...actionable, ...remainder];
}

function FocusedApproval({
  canApprove,
  currentUserId,
  focusedTask,
  onDecision,
  online,
}: {
  readonly canApprove: boolean;
  readonly currentUserId: string | undefined;
  readonly focusedTask: ApprovalTask;
  readonly onDecision: (decision: 'approved' | 'rejected') => void;
  readonly online: boolean;
}): React.JSX.Element {
  const selfApproval = currentUserId === focusedTask.requestedById;
  const actionable = focusedTask.status === 'pending' && canApprove && !selfApproval;
  return (
    <>
      <div className={styles.focusTopline}>
        <div>
          <p className="qf-eyebrow">Selected request</p>
          <h2 id="approval-review-title">{requestTypeLabel(focusedTask.workflowName)}</h2>
        </div>
        <StatusBadge
          status={focusedTask.status}
          label={
            focusedTask.status === 'pending'
              ? actionable
                ? 'Ready for you'
                : 'Waiting'
              : focusedTask.status === 'approved'
                ? 'Approved'
                : 'Declined'
          }
        />
      </div>
      <div className={styles.evidencePreview}>
        <span>Request summary</span>
        <p>{approvalPayloadDigest(focusedTask.payloadSummary)}</p>
      </div>
      <dl className={styles.focusFacts}>
        <div>
          <dt>Requested by</dt>
          <dd>{focusedTask.requestedByName}</dd>
        </div>
        <div>
          <dt>Waiting since</dt>
          <dd>
            <DateTime value={focusedTask.createdAt} />
          </dd>
        </div>
      </dl>
      {selfApproval ? (
        <p className={styles.focusPolicy}>Your own request. Another approver must decide.</p>
      ) : null}
      <div className={styles.focusActions}>
        <Button
          disabled={!actionable || !online}
          icon={<Check size={16} />}
          onClick={() => onDecision('approved')}
          tone="primary"
        >
          Approve
        </Button>
        <Button
          disabled={!actionable || !online}
          icon={<X size={16} />}
          onClick={() => onDecision('rejected')}
          tone="quiet"
        >
          Decline
        </Button>
        <Link
          className={styles.focusLink}
          href={`/requests/detail?id=${encodeURIComponent(focusedTask.requestId)}`}
          prefetch={false}
        >
          Open full request
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    </>
  );
}

export function ApprovalsScreen(): React.JSX.Element {
  const pagination = usePagination(10);
  const [selected, setSelected] = useState<{
    readonly decision: 'approved' | 'rejected';
    readonly task: ApprovalTask;
  } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const { can, online, session } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const approvalsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['approvals', pagination.page, pagination.pageSize],
    queryFn: ({ signal }) =>
      apiRequest(`${routes.approvals}?${pageSearchParams(pagination).toString()}`, {
        schema: PagedApprovalsSchema,
        signal,
      }),
  });
  const selectedRequestQuery = useQuery({
    enabled: selected !== null,
    queryKey: ['request', selected?.task.requestId],
    queryFn: ({ signal }) => {
      if (selected === null) throw new Error('No approval request is selected.');
      return apiRequest(routes.request(selected.task.requestId), {
        schema: WorkflowRequestViewSchema,
        signal,
      });
    },
  });
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<DecisionForm>({ defaultValues: { note: '' }, mode: 'onBlur' });
  const decisionNote = useWatch({ control, name: 'note' });
  const decisionDetailsReady = approvalDecisionDetailsReady({
    error: selectedRequestQuery.error,
    hasDetails: selectedRequestQuery.data !== undefined,
    isLoading: selectedRequestQuery.isLoading,
  });
  const decisionKey = useIdempotencyKeyLease(
    JSON.stringify({
      decision: selected?.decision ?? null,
      note: decisionNote ?? '',
      revision: selected?.task.revision ?? null,
      taskId: selected?.task.id ?? null,
    }),
  );
  const decisionMutation = useMutation({
    mutationFn: ({
      decision,
      note,
      task,
    }: {
      readonly decision: 'approved' | 'rejected';
      readonly note?: string;
      readonly task: ApprovalTask;
    }) => {
      const input = ApprovalDecisionInputSchema.parse({
        decision,
        expectedRevision: task.revision,
        note,
      });
      return apiRequest<unknown>(routes.approvalDecision(task.id), {
        body: input,
        idempotencyKey: decisionKey.acquire(),
        method: 'POST',
      });
    },
    onSuccess: async (_, variables) => {
      decisionKey.clear();
      notify(
        variables.decision === 'approved'
          ? 'Request approved. QueueForge will start the next step.'
          : 'Request declined. The requester can see your decision.',
        'success',
      );
      setSelected(null);
      reset();
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  const submit = handleSubmit(async (values) => {
    if (selected === null || !decisionDetailsReady) return;
    const note = values.note?.trim();
    await decisionMutation.mutateAsync({
      ...selected,
      note: note !== undefined && note !== '' ? note : undefined,
    });
  });
  const cancelDecision = (): void => {
    decisionKey.clear();
    decisionMutation.reset();
    setSelected(null);
  };

  const rows = approvalsQuery.data?.items ?? EMPTY_APPROVAL_ROWS;
  const normalizedSearch = searchInput.trim().toLowerCase();
  const filteredRows = useMemo(
    () =>
      normalizedSearch === ''
        ? rows
        : rows.filter((row) => approvalMatchesSearch(row, normalizedSearch)),
    [normalizedSearch, rows],
  );
  const canApprove = can('approve');
  const currentUserId = session?.user.id;
  const actionableOnPage = rows.filter(
    (row) => row.status === 'pending' && canApprove && currentUserId !== row.requestedById,
  ).length;
  const pendingOnPage = rows.filter((row) => row.status === 'pending').length;
  const lockedOnPage = rows.filter(
    (row) => row.status === 'pending' && currentUserId === row.requestedById,
  ).length;
  const prioritizedRows = useMemo(
    () => prioritizeApprovalsForFocus({ canApprove, currentUserId, rows: filteredRows }),
    [canApprove, currentUserId, filteredRows],
  );
  const focusedTask =
    prioritizedRows.find((row) => row.id === focusedTaskId) ?? prioritizedRows[0] ?? null;

  return (
    <AppShell>
      <RouteHero
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={approvalsQuery.isFetching}
            onClick={() => void approvalsQuery.refetch()}
          >
            Refresh
          </Button>
        }
        description="Review each request, compare the submitted details, and record a clear decision."
        eyebrow="Approval inbox"
        icon={<ClipboardCheck size={18} />}
        meta={<span>Actionable requests are listed first · current page</span>}
        title="Decisions waiting for you"
        tone="signal"
        visual={
          <HeroMetrics
            items={[
              {
                label: 'Ready now',
                tone: actionableOnPage > 0 ? 'signal' : 'role',
                value: approvalsQuery.isLoading ? '…' : actionableOnPage,
              },
              {
                label: 'Waiting in view',
                tone: pendingOnPage > 0 ? 'warning' : 'role',
                value: approvalsQuery.isLoading ? '…' : pendingOnPage,
              },
              {
                label: 'Policy locked',
                tone: lockedOnPage > 0 ? 'danger' : 'role',
                value: approvalsQuery.isLoading ? '…' : lockedOnPage,
              },
              {
                label: 'Shown on page',
                value: approvalsQuery.isLoading ? '…' : rows.length,
              },
            ]}
          />
        }
      />
      {!can('approve') ? (
        <div className="qf-inline-alert" role="note">
          <ShieldAlert size={18} aria-hidden="true" />
          <p>This page is read-only for your role. An approver must make the final decision.</p>
        </div>
      ) : null}
      <ScrollReveal>
        <Panel
          className={styles.queuePanel}
          description="Choose a request on the left, review it on the right, then approve or decline."
          title="Approval queue"
        >
          <QueryState
            empty={approvalsQuery.isSuccess && rows.length === 0}
            emptyDescription="Nothing needs your decision right now. New requests will appear here when they need approval."
            emptyTitle="You are all caught up"
            error={approvalsQuery.error}
            isLoading={approvalsQuery.isLoading}
            onRetry={() => void approvalsQuery.refetch()}
          >
            <div className={styles.queueLedger}>
              <div className={styles.searchBar}>
                <Search aria-hidden="true" size={17} />
                <InputField
                  id="approval-search"
                  label="Search approvals"
                  maxLength={160}
                  onChange={(event) => setSearchInput(event.currentTarget.value)}
                  placeholder="Request type, person, or detail"
                  type="search"
                  value={searchInput}
                />
                <span className="qf-utility">Current page only</span>
              </div>
              <div className={styles.queueSplit}>
                <section className={styles.queueList} aria-labelledby="approval-list-title">
                  <header>
                    <div>
                      <p className="qf-eyebrow">Actionable first</p>
                      <h2 id="approval-list-title">Requests to review</h2>
                    </div>
                    <span>{String(filteredRows.length)} shown</span>
                  </header>
                  <div className={styles.queueRows}>
                    {prioritizedRows.length === 0 ? (
                      <p className={styles.noMatches}>No approvals match your search.</p>
                    ) : (
                      prioritizedRows.map((task) => {
                        const selfApproval = currentUserId === task.requestedById;
                        const actionable = task.status === 'pending' && canApprove && !selfApproval;
                        return (
                          <button
                            aria-controls="approval-review"
                            aria-pressed={focusedTask?.id === task.id}
                            className={styles.queueRow}
                            data-actionable={actionable}
                            key={task.id}
                            onClick={() => setFocusedTaskId(task.id)}
                            type="button"
                          >
                            <span className={styles.rowTopline}>
                              <strong>{requestTypeLabel(task.workflowName)}</strong>
                              <StatusBadge
                                status={task.status}
                                label={
                                  task.status === 'pending'
                                    ? actionable
                                      ? 'Ready for you'
                                      : 'Waiting'
                                    : task.status === 'approved'
                                      ? 'Approved'
                                      : 'Declined'
                                }
                              />
                            </span>
                            <span className={styles.rowSummary}>
                              {approvalPayloadDigest(task.payloadSummary)}
                            </span>
                            <span className={styles.rowMeta}>
                              <span>{task.requestedByName}</span>
                              <DateTime value={task.createdAt} />
                            </span>
                            {selfApproval ? (
                              <span className={styles.policyNote}>
                                Another approver must decide your own request.
                              </span>
                            ) : null}
                          </button>
                        );
                      })
                    )}
                  </div>
                </section>
                <AnimatePresence initial={false} mode="wait">
                  <m.section
                    animate={{ opacity: 1, x: 0 }}
                    aria-labelledby="approval-review-title"
                    className={styles.reviewPanel}
                    exit={reducedMotion === true ? undefined : { opacity: 0, x: -8 }}
                    id="approval-review"
                    initial={reducedMotion === true ? false : { opacity: 0, x: 12 }}
                    key={focusedTask?.id ?? 'empty'}
                    transition={{
                      duration: reducedMotion === true ? 0 : 0.22,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    {focusedTask === null ? (
                      <div className={styles.emptyFocus}>
                        <p className="qf-eyebrow">Request review</p>
                        <h2 id="approval-review-title">Nothing selected</h2>
                        <p>Change the search or choose a request from the queue.</p>
                      </div>
                    ) : (
                      <FocusedApproval
                        canApprove={canApprove}
                        currentUserId={currentUserId}
                        focusedTask={focusedTask}
                        online={online}
                        onDecision={(decision) => setSelected({ decision, task: focusedTask })}
                      />
                    )}
                  </m.section>
                </AnimatePresence>
              </div>
            </div>
          </QueryState>
          {approvalsQuery.data?.meta === undefined ? null : (
            <PaginationControls
              ariaLabel="Approvals"
              disabled={approvalsQuery.isFetching}
              meta={approvalsQuery.data.meta}
              onPageChange={pagination.setPage}
              onPageSizeChange={pagination.setPageSize}
              page={pagination.page}
              pageSize={pagination.pageSize}
            />
          )}
        </Panel>
      </ScrollReveal>
      <Dialog
        description={
          selected === null
            ? undefined
            : `${selected.decision === 'approved' ? 'Approve' : 'Reject'} ${requestTypeLabel(selected.task.workflowName)}, requested by ${selected.task.requestedByName}.`
        }
        footer={
          <>
            <Button onClick={cancelDecision}>Cancel</Button>
            <Button
              disabled={!online || !decisionDetailsReady}
              loading={decisionMutation.isPending}
              loadingLabel="Recording"
              onClick={() => void submit()}
              tone={selected?.decision === 'rejected' ? 'danger' : 'primary'}
            >
              {selected?.decision === 'rejected' ? 'Decline request' : 'Approve request'}
            </Button>
          </>
        }
        onClose={cancelDecision}
        open={selected !== null}
        title={
          selected?.decision === 'rejected' ? 'Decline this request?' : 'Approve this request?'
        }
      >
        {decisionMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(decisionMutation.error)}
          </div>
        ) : null}
        {selected === null ? null : (
          <div className={styles.decisionCallout} data-decision={selected.decision}>
            <span aria-hidden="true">
              {selected.decision === 'approved' ? <Check size={19} /> : <X size={19} />}
            </span>
            <div>
              <strong>
                {selected.decision === 'approved'
                  ? 'This request will move forward.'
                  : 'This request will stop here.'}
              </strong>
              <p>Your identity and optional note will be recorded with the decision.</p>
            </div>
          </div>
        )}
        <form onSubmit={(event) => void submit(event)} noValidate>
          {selectedRequestQuery.isLoading ? (
            <div className="qf-form-skeleton" aria-label="Loading request details" role="status">
              <span />
              <span />
              <span />
            </div>
          ) : selectedRequestQuery.error !== null ? (
            <InlineLoadError
              error={selectedRequestQuery.error}
              onRetry={() => void selectedRequestQuery.refetch()}
              retrying={selectedRequestQuery.isFetching}
              title="Could not load request details"
            />
          ) : selectedRequestQuery.data === undefined ? null : (
            <HumanReadablePayload
              payload={selectedRequestQuery.data.payload}
              title={
                selected === null
                  ? 'Request information'
                  : requestTypeLabel(selected.task.workflowName)
              }
            />
          )}
          <TextareaField
            error={errors.note?.message}
            helper="Optional: explain the reason for your decision in plain language."
            id="approval-note"
            label="Note for the requester"
            maxLength={2000}
            {...register('note')}
          />
        </form>
      </Dialog>
    </AppShell>
  );
}

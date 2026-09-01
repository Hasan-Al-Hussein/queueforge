'use client';

import { Fragment, useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Button,
  CheckCircle2,
  Dialog,
  InputField,
  Panel,
  RefreshCw,
  RotateCcw,
  StatusBadge,
  cn,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { CompactId, DateTime } from '../../components/format';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
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
  MOBILE_RECOVERY_PREVIEW_SIZE,
  automaticTryLabel,
  failureExplanation,
  queueDisplayName,
  queueStatePresentation,
  recoveryPreviewToggleLabel,
  requestTypeDisplayName,
} from './processing-presentation';
import styles from './operations-screen.module.css';

const LEDGER_PAGE_SIZE = 10;

function QueueRow({ queue }: { readonly queue: QueueSnapshot }): React.JSX.Element {
  const state = queueStatePresentation(queue);
  return (
    <article className={styles.queueLane}>
      <header className={styles.queueLaneHeader}>
        <div>
          <p className={styles.kicker}>Processing lane</p>
          <h3>{queueDisplayName(queue.name)}</h3>
        </div>
        <StatusBadge status={state.status} label={state.label} />
      </header>

      {queue.telemetryAvailable ? (
        <dl className={styles.queueMeasures}>
          <div>
            <dt>Waiting</dt>
            <dd>{queue.waiting}</dd>
          </div>
          <div>
            <dt>Running</dt>
            <dd>{queue.active}</dd>
          </div>
          <div>
            <dt>Retrying later</dt>
            <dd>{queue.delayed}</dd>
          </div>
          <div data-attention={queue.failed > 0 ? 'true' : 'false'}>
            <dt>Stopped</dt>
            <dd>{queue.failed}</dd>
          </div>
        </dl>
      ) : null}

      <div className={styles.desktopQueueEvidence}>
        <dl className={styles.queueEvidence}>
          <div>
            <dt>Accepted, not started</dt>
            <dd>{String(queue.outboxBacklog)} saved safely</dd>
          </div>
          <div data-attention={queue.outboxDead > 0 ? 'true' : 'false'}>
            <dt>Handoff problems</dt>
            <dd>{String(queue.outboxDead)} need help</dd>
          </div>
          {queue.telemetryAvailable ? (
            <div>
              <dt>Background processor</dt>
              <dd>
                {String(queue.workerCount)} processor{queue.workerCount === 1 ? '' : 's'} ·{' '}
                {state.workerLabel}
              </dd>
            </div>
          ) : null}
        </dl>

        {queue.telemetryAvailable ? (
          <p className={styles.heartbeat}>
            {queue.heartbeatAt === null ? (
              'No recent processor check-in'
            ) : (
              <>
                Last processor check-in <DateTime value={queue.heartbeatAt} />
              </>
            )}
          </p>
        ) : (
          <p className={styles.heartbeat}>
            Live processor details are available only to platform administrators.
          </p>
        )}
      </div>

      <div className={styles.mobileQueueEvidence}>
        <dl className={styles.queueEvidence}>
          <div>
            <dt>Accepted, not started</dt>
            <dd>{String(queue.outboxBacklog)} saved safely</dd>
          </div>
          <div data-attention={queue.outboxDead > 0 ? 'true' : 'false'}>
            <dt>Handoff problems</dt>
            <dd>{String(queue.outboxDead)} need help</dd>
          </div>
        </dl>
        <details className={cn('qf-advanced-disclosure', styles.mobileProcessorDetails)}>
          <summary>Processor details</summary>
          {queue.telemetryAvailable ? (
            <dl className="qf-key-values">
              <dt>Background processor</dt>
              <dd>
                {String(queue.workerCount)} processor{queue.workerCount === 1 ? '' : 's'} ·{' '}
                {state.workerLabel}
              </dd>
              <dt>Latest check-in</dt>
              <dd>
                {queue.heartbeatAt === null ? (
                  'No recent processor check-in'
                ) : (
                  <DateTime value={queue.heartbeatAt} />
                )}
              </dd>
            </dl>
          ) : (
            <p className={styles.heartbeat}>
              Live processor details are available only to platform administrators.
            </p>
          )}
        </details>
      </div>
    </article>
  );
}

function RecoveryLedger({
  expanded,
  items,
  online,
  onRetry,
}: {
  readonly expanded: boolean;
  readonly items: readonly DeadLetter[];
  readonly online: boolean;
  readonly onRetry: (item: DeadLetter) => void;
}): React.JSX.Element {
  return (
    <div
      aria-label="Requests that need attention"
      className={styles.recoveryLedger}
      data-expanded={expanded ? 'true' : 'false'}
      id="recovery-request-ledger"
      role="list"
    >
      {items.map((item) => (
        <article className={styles.recoveryItem} key={item.id} role="listitem">
          <div className={styles.recoveryLead}>
            <span className={styles.recoveryMarker} aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <div>
              <p className={styles.kicker}>Automatic tries exhausted</p>
              <h3>
                <Link
                  className="qf-table-link"
                  href={`/requests/detail?id=${encodeURIComponent(item.requestId)}`}
                  prefetch={false}
                >
                  {requestTypeDisplayName(item.workflowName)}
                </Link>
              </h3>
              <p>{failureExplanation(item.reason)}</p>
            </div>
          </div>
          <dl className={styles.recoveryEvidence}>
            <div>
              <dt>Automatic attempts</dt>
              <dd>{automaticTryLabel(item.attemptCount)}</dd>
            </div>
            <div>
              <dt>Stopped</dt>
              <dd>
                <DateTime value={item.deadLetteredAt} />
              </dd>
            </div>
          </dl>
          <details className={cn('qf-advanced-disclosure', styles.technicalDetails)}>
            <summary>Technical evidence</summary>
            <dl className="qf-key-values">
              <dt>Stored request type</dt>
              <dd>
                <code>{item.workflowName}</code>
              </dd>
              <dt>Request reference</dt>
              <dd>
                <CompactId value={item.requestId} />
              </dd>
              <dt>Failure reason</dt>
              <dd>
                <code>{item.reason}</code>
              </dd>
            </dl>
          </details>
          <PermissionGate permission="retry">
            <Button
              disabled={!online}
              icon={<RotateCcw size={15} />}
              onClick={() => onRetry(item)}
              tone="quiet"
            >
              Try again
            </Button>
          </PermissionGate>
        </article>
      ))}
    </div>
  );
}

export function OperationsScreen(): React.JSX.Element {
  const deadLetterPagination = usePagination(LEDGER_PAGE_SIZE);
  const [retryItem, setRetryItem] = useState<DeadLetter | null>(null);
  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryPreviewExpanded, setRecoveryPreviewExpanded] = useState(false);
  const deferredRecoverySearch = useDeferredValue(recoverySearch.trim().toLowerCase());
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
      setRecoveryPreviewExpanded(false);
      deadLetterPagination.resetPage();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dead-letters'] }),
        queryClient.invalidateQueries({ queryKey: ['queues'] }),
      ]);
    },
  });
  const queueRows = useMemo(() => queuesQuery.data ?? [], [queuesQuery.data]);
  const deadLetters = useMemo(
    () => deadLettersQuery.data?.items ?? [],
    [deadLettersQuery.data?.items],
  );
  const filteredDeadLetters = useMemo(() => {
    if (deferredRecoverySearch === '') return deadLetters;
    return deadLetters.filter((item) =>
      `${item.workflowName} ${item.requestId} ${item.reason}`
        .toLowerCase()
        .includes(deferredRecoverySearch),
    );
  }, [deadLetters, deferredRecoverySearch]);
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
  const needsRecovery = deadLetters.length > 0;
  const hasIncident = needsRecovery || totals.failed + totals.outboxDead > 0;
  const latestHeartbeat = queueRows.reduce<string | null>((latest, queue) => {
    if (queue.heartbeatAt === null) return latest;
    return latest === null || queue.heartbeatAt > latest ? queue.heartbeatAt : latest;
  }, null);

  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
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
          description="Monitor accepted work, processor health, and requests that need a deliberate retry."
          eyebrow="Operations"
          icon={needsRecovery ? <AlertTriangle size={18} /> : <Activity size={18} />}
          meta={
            telemetryAvailable
              ? 'Live processor telemetry · 15 second refresh'
              : 'Workspace-scoped durable handoff view'
          }
          title="Processing"
          tone={needsRecovery ? 'warning' : 'signal'}
        />

        <ScrollReveal>
          <section
            aria-labelledby="processing-status-title"
            className={styles.statusStrip}
            data-attention={hasIncident ? 'true' : 'false'}
          >
            <span className={styles.statusIcon} aria-hidden="true">
              {hasIncident ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}
            </span>
            <div className={styles.statusCopy}>
              <h2 id="processing-status-title">
                {hasIncident
                  ? `${String(deadLetters.length + totals.outboxDead)} item${deadLetters.length + totals.outboxDead === 1 ? '' : 's'} need attention`
                  : 'Processing is healthy'}
              </h2>
              <p>
                {latestHeartbeat === null ? (
                  telemetryAvailable ? (
                    'No recent processor check-in'
                  ) : (
                    'Live processor details require platform administrator access.'
                  )
                ) : (
                  <>
                    Latest processor check-in <DateTime value={latestHeartbeat} />
                  </>
                )}
              </p>
            </div>
            <dl className={styles.statusMeasures}>
              <div>
                <dt>Waiting</dt>
                <dd>{totals.waiting + totals.delayed}</dd>
              </div>
              <div>
                <dt>Running</dt>
                <dd>{totals.active}</dd>
              </div>
              <div>
                <dt>Committed</dt>
                <dd>{totals.outboxBacklog}</dd>
              </div>
              <div data-attention={hasIncident ? 'true' : 'false'}>
                <dt>Needs help</dt>
                <dd>{deadLetters.length + totals.outboxDead}</dd>
              </div>
            </dl>
          </section>
        </ScrollReveal>

        <ScrollReveal amount={0.08}>
          <div className={styles.workArea} data-has-incidents={needsRecovery ? 'true' : 'false'}>
            <Panel
              className={styles.recoveryPanel}
              title="Requests needing recovery"
              description="Review the failure before starting another try. Earlier attempts remain in the request history."
              actions={
                <span className="qf-save-state">
                  <AlertTriangle size={15} />
                  Review before retry
                </span>
              }
            >
              <QueryState
                empty={deadLettersQuery.isSuccess && deadLetters.length === 0}
                emptyDescription="Every request has finished or still has an automatic try available."
                emptyTitle="Nothing needs help"
                error={deadLettersQuery.error}
                isLoading={deadLettersQuery.isLoading}
                onRetry={() => void deadLettersQuery.refetch()}
              >
                <div className={styles.searchBar}>
                  <InputField
                    id="recovery-ledger-search"
                    label="Search requests that need attention"
                    onChange={(event) => {
                      setRecoveryPreviewExpanded(false);
                      setRecoverySearch(event.currentTarget.value);
                    }}
                    placeholder="Request type, reference, or reason"
                    type="search"
                    value={recoverySearch}
                  />
                  <span className="qf-utility" aria-live="polite">
                    {String(filteredDeadLetters.length)} of {String(deadLetters.length)} on this
                    page
                  </span>
                </div>
                {filteredDeadLetters.length === 0 ? (
                  <div className={styles.localEmpty} role="status">
                    No recovery item on this page matches that search.
                  </div>
                ) : (
                  <RecoveryLedger
                    expanded={recoveryPreviewExpanded}
                    items={filteredDeadLetters}
                    online={online}
                    onRetry={setRetryItem}
                  />
                )}
                {filteredDeadLetters.length > MOBILE_RECOVERY_PREVIEW_SIZE ? (
                  <Button
                    aria-controls="recovery-request-ledger"
                    aria-expanded={recoveryPreviewExpanded}
                    className={styles.mobileLedgerToggle}
                    onClick={() => setRecoveryPreviewExpanded((expanded) => !expanded)}
                    tone="quiet"
                  >
                    {recoveryPreviewToggleLabel(
                      filteredDeadLetters.length,
                      recoveryPreviewExpanded,
                    )}
                  </Button>
                ) : null}
              </QueryState>
              {deadLettersQuery.data?.meta === undefined ||
              deadLettersQuery.data.meta.totalItems === 0 ? null : (
                <PaginationControls
                  ariaLabel="Requests that need attention"
                  disabled={deadLettersQuery.isFetching}
                  meta={deadLettersQuery.data.meta}
                  onPageChange={(page) => {
                    setRecoveryPreviewExpanded(false);
                    deadLetterPagination.setPage(page);
                  }}
                  onPageSizeChange={(pageSize) => {
                    setRecoveryPreviewExpanded(false);
                    deadLetterPagination.setPageSize(pageSize);
                  }}
                  page={deadLetterPagination.page}
                  pageSize={deadLetterPagination.pageSize}
                />
              )}
            </Panel>

            <Panel
              className={styles.lanesPanel}
              title="Processing lanes"
              description={
                telemetryAvailable
                  ? 'Exact waiting, running, retrying, and stopped state for each processor.'
                  : 'This workspace can see safely accepted work. Platform administrators can also inspect processor telemetry.'
              }
              actions={
                <span className="qf-save-state">
                  <Activity size={15} />
                  {telemetryAvailable ? 'Updates automatically' : 'Workspace scope'}
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
                <div className={styles.queueGrid}>
                  {queueRows.map((queue) => (
                    <QueueRow key={queue.name} queue={queue} />
                  ))}
                </div>
                {queueRows.length === 0 ? null : (
                  <details className={cn('qf-advanced-disclosure', styles.queueNames)}>
                    <summary>Technical queue names</summary>
                    <dl className="qf-key-values">
                      {queueRows.map((queue) => (
                        <Fragment key={queue.name}>
                          <dt>{queueDisplayName(queue.name)}</dt>
                          <dd>
                            <code>{queue.name}</code>
                          </dd>
                        </Fragment>
                      ))}
                    </dl>
                  </details>
                )}
              </QueryState>
            </Panel>
          </div>
        </ScrollReveal>
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

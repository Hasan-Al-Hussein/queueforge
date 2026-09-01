'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { gql, NetworkStatus } from '@apollo/client';
import { useQuery } from '@apollo/client/react';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { WorkflowRequestViewSchema } from '@queueforge/contracts';
import {
  ArrowLeft,
  Ban,
  Button,
  Dialog,
  Panel,
  QueueRail,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  StatePanel,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { stripGraphqlTypenames } from '../../api/graphql-response';
import { CompactId, DateTime } from '../../components/format';
import { HumanReadablePayload } from '../../components/human-readable-payload';
import { QueryState } from '../../components/query-state';
import { RouteHero, type HeroTone } from '../../components/route-hero';
import { RequestDetailSchema, type RequestDetail } from '../../domain/models';
import {
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTypeLabel,
} from '../../domain/presentation';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useStaticSearchParam } from '../../hooks/use-static-search-param';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { requestTimelineItems } from './request-detail-timeline';
import styles from './request-detail-screen.module.css';

const REQUEST_DETAIL_QUERY = gql`
  query RequestDetail($id: ID!) {
    requestDetail(id: $id) {
      request {
        id
        workflowId
        workflowVersionId
        workflowName
        versionNo
        status
        source
        payload
        correlationId
        submittedAt
        statusChangedAt
        attemptCount
        maxAttempts
      }
      transitions {
        id
        fromStatus
        toStatus
        reason
        actorName
        occurredAt
      }
      approval {
        id
        status
        requestedBy
        decidedBy
        note
        revision
      }
    }
  }
`;

interface RequestDetailQueryData {
  readonly requestDetail: RequestDetail;
}

type Command = 'cancel' | 'retry';

const PROOF_STAGES = ['Intake', 'Decision', 'Queue', 'Outcome'] as const;
const PROOF_STAGE_DESCRIPTIONS = [
  'Input accepted and version-bound.',
  'Human policy recorded when required.',
  'Durable work and retries preserved.',
  'Final effect and evidence sealed.',
] as const;

interface ProofStage {
  readonly description: string;
  readonly label: string;
  readonly state: 'attention' | 'complete' | 'current' | 'upcoming';
}

function requestStageIndex(status: RequestDetail['request']['status']): number {
  if (status === 'received' || status === 'validation_failed') return 0;
  if (status === 'pending_approval' || status === 'approved' || status === 'rejected') return 1;
  if (
    status === 'queued' ||
    status === 'processing' ||
    status === 'failed' ||
    status === 'dead_lettered'
  )
    return 2;
  return 3;
}

function requestOutcomeCopy(status: RequestDetail['request']['status']): string {
  switch (status) {
    case 'pending_approval':
      return 'A human decision is the next handoff.';
    case 'queued':
    case 'approved':
    case 'received':
      return 'QueueForge accepted the work and is preparing the next handoff.';
    case 'processing':
      return 'A worker is processing this request now.';
    case 'succeeded':
      return 'The work completed and its full attempt history is preserved.';
    case 'failed':
      return 'QueueForge is preparing another safe attempt.';
    case 'dead_lettered':
      return 'Automatic attempts are exhausted. An operator can review and retry.';
    case 'cancelled':
      return 'This request was stopped before completion.';
    case 'rejected':
      return 'The approval gate declined this request.';
    case 'validation_failed':
      return 'The submitted information did not pass validation.';
  }
}

function requestNextAction(status: RequestDetail['request']['status']): string {
  switch (status) {
    case 'pending_approval':
      return 'An approver reviews the request.';
    case 'received':
    case 'approved':
    case 'queued':
      return 'QueueForge dispatches the next durable step.';
    case 'processing':
      return 'Wait for the active worker attempt.';
    case 'failed':
      return 'QueueForge retries within the configured limit.';
    case 'dead_lettered':
      return 'An operator reviews the failure and may retry.';
    case 'succeeded':
      return 'No action needed. The result is preserved.';
    case 'cancelled':
    case 'rejected':
    case 'validation_failed':
      return 'No further processing is scheduled.';
  }
}

function requestOwner(status: RequestDetail['request']['status']): string {
  if (status === 'pending_approval') return 'Approver';
  if (status === 'dead_lettered') return 'Operator';
  if (['approved', 'failed', 'processing', 'queued', 'received'].includes(status)) {
    return 'QueueForge worker';
  }
  return 'Recorded outcome';
}

export function formatRequestAge(value: string, now: number): string {
  const elapsed = Math.max(0, now - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Less than a minute';
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)} hr${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${String(days)} day${days === 1 ? '' : 's'}`;
}

function requestHeroTone(status: RequestDetail['request']['status']): HeroTone {
  if (status === 'succeeded') return 'signal';
  if (status === 'pending_approval') return 'warning';
  if (
    status === 'cancelled' ||
    status === 'dead_lettered' ||
    status === 'rejected' ||
    status === 'validation_failed'
  )
    return 'danger';
  return 'role';
}

function requestProofStages(status: RequestDetail['request']['status']): readonly ProofStage[] {
  const currentStage = requestStageIndex(status);
  const attention =
    status === 'cancelled' ||
    status === 'dead_lettered' ||
    status === 'rejected' ||
    status === 'validation_failed';
  return PROOF_STAGES.map((label, index) => {
    const completedOutcome = status === 'succeeded' && index === currentStage;
    const state: ProofStage['state'] =
      attention && index === currentStage
        ? 'attention'
        : index < currentStage || completedOutcome
          ? 'complete'
          : index === currentStage
            ? 'current'
            : 'upcoming';
    return { description: PROOF_STAGE_DESCRIPTIONS[index] ?? '', label, state };
  });
}

export function RequestDetailScreen(): React.JSX.Element {
  const search = useStaticSearchParam('id');
  const requestId =
    search.value !== null && z.string().uuid().safeParse(search.value).success
      ? search.value
      : null;
  const detailQuery = useQuery<RequestDetailQueryData>(REQUEST_DETAIL_QUERY, {
    notifyOnNetworkStatusChange: true,
    skip: requestId === null,
    variables: { id: requestId ?? '' },
  });
  const [command, setCommand] = useState<Command | null>(null);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const commandKey = useIdempotencyKeyLease(`${requestId ?? 'no-request'}:${command ?? 'none'}`);
  const { can, online, session } = useAuth();
  const { notify } = useToast();
  useEffect(() => {
    const update = (): void => setCurrentTime(Date.now());
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const parsed = useMemo(() => {
    if (detailQuery.data === undefined) return null;
    const result = RequestDetailSchema.safeParse(
      stripGraphqlTypenames(detailQuery.data.requestDetail, [
        ['request'],
        ['transitions', '*'],
        ['approval'],
      ]),
    );
    return result.success ? result.data : null;
  }, [detailQuery.data]);
  const invalidResponse =
    detailQuery.data !== undefined && parsed === null
      ? new Error('Request detail did not match the contract.')
      : null;
  const commandMutation = useMutation({
    mutationFn: async (nextCommand: Command) => {
      if (requestId === null) throw new Error('Request ID is missing.');
      return apiRequest(
        nextCommand === 'cancel' ? routes.requestCancel(requestId) : routes.requestRetry(requestId),
        {
          idempotencyKey: commandKey.acquire(),
          method: 'POST',
          schema: WorkflowRequestViewSchema,
        },
      );
    },
    onSuccess: async (_, completedCommand) => {
      commandKey.clear();
      notify(
        completedCommand === 'cancel' ? 'Cancellation recorded.' : 'Request re-queued.',
        'success',
      );
      setCommand(null);
      await detailQuery.refetch();
    },
  });
  const cancelCommand = (): void => {
    commandKey.clear();
    commandMutation.reset();
    setCommand(null);
  };

  const canCancel =
    parsed !== null &&
    can('cancel') &&
    ['pending_approval', 'queued'].includes(parsed.request.status);
  const canRetry =
    parsed !== null && can('retry') && ['failed', 'dead_lettered'].includes(parsed.request.status);
  const workspaceRole =
    session?.user.platformRole === 'platform_admin'
      ? 'tenant_admin'
      : (session?.selectedTenant.role ?? 'viewer');
  const backDestination =
    workspaceRole === 'approver'
      ? { href: '/approvals' as const, label: 'Approval inbox' }
      : workspaceRole === 'operator' || workspaceRole === 'viewer'
        ? { href: '/requests' as const, label: 'Request history' }
        : { href: '/' as const, label: 'Admin overview' };

  return (
    <AppShell>
      <RouteHero
        actions={
          <div className={styles.headerActions}>
            <Link
              className="qf-button qf-button--quiet"
              href={backDestination.href}
              prefetch={false}
            >
              <ArrowLeft size={16} />
              {backDestination.label}
            </Link>
            <Button
              icon={<RefreshCw size={16} />}
              loading={detailQuery.networkStatus === NetworkStatus.refetch}
              onClick={() => void detailQuery.refetch()}
            >
              Refresh
            </Button>
          </div>
        }
        className={parsed?.request.status === 'succeeded' ? styles.sealedHero : undefined}
        description={
          parsed === null
            ? 'See what was requested, where it is now, and what happened along the way.'
            : requestOutcomeCopy(parsed.request.status)
        }
        eyebrow={parsed === null ? 'Request details' : 'Chain of custody'}
        icon={<ShieldCheck size={18} />}
        meta={
          parsed === null ? null : (
            <>
              <StatusBadge
                status={parsed.request.status}
                label={requestStatusLabel(parsed.request.status)}
              />
              <span>{requestProgressLabel(parsed.request)}</span>
              {parsed.request.status === 'succeeded' ? (
                <span className={styles.proofSeal}>
                  <ShieldCheck aria-hidden="true" size={15} />
                  Proof sealed · outcome preserved
                </span>
              ) : null}
            </>
          )
        }
        title={parsed === null ? 'Request' : requestTypeLabel(parsed.request.workflowName)}
        tone={parsed === null ? 'role' : requestHeroTone(parsed.request.status)}
      />

      {!search.ready ? (
        <StatePanel
          description="Reading the request identifier from this static route."
          kind="loading"
          title="Opening request"
        />
      ) : requestId === null ? (
        <StatePanel
          action={
            <Link
              className="qf-button qf-button--secondary"
              href={backDestination.href}
              prefetch={false}
            >
              Return to {backDestination.label.toLowerCase()}
            </Link>
          }
          description="This static detail route requires a valid UUID in the id query parameter."
          kind="empty"
          title="No request selected"
        />
      ) : (
        <QueryState
          error={detailQuery.error ?? invalidResponse}
          isLoading={detailQuery.loading && parsed === null}
          onRetry={() => void detailQuery.refetch()}
        >
          {parsed !== null ? (
            <>
              <ScrollReveal>
                <dl className={styles.statusBoard}>
                  <div data-primary="true">
                    <dt>Current state</dt>
                    <dd>
                      <StatusBadge
                        status={parsed.request.status}
                        label={requestStatusLabel(parsed.request.status)}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt>Next action</dt>
                    <dd>{requestNextAction(parsed.request.status)}</dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>{requestOwner(parsed.request.status)}</dd>
                  </div>
                  <div>
                    <dt>Time in state</dt>
                    <dd>
                      {currentTime === null
                        ? 'Calculating…'
                        : formatRequestAge(parsed.request.statusChangedAt, currentTime)}
                    </dd>
                  </div>
                </dl>
              </ScrollReveal>

              <ScrollReveal>
                <section className={styles.proofSpine} aria-labelledby="proof-spine-title">
                  <header>
                    <div>
                      <p className="qf-eyebrow">Proof spine</p>
                      <h2 id="proof-spine-title">Chain of custody</h2>
                    </div>
                    <span>{requestProgressLabel(parsed.request)}</span>
                  </header>
                  <ol>
                    {requestProofStages(parsed.request.status).map((stage, index) => (
                      <li data-state={stage.state} key={stage.label}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                          <strong>{stage.label}</strong>
                          <p>{stage.description}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              </ScrollReveal>

              {canCancel || canRetry ? (
                <div className={styles.stickyActionBar} aria-label="Available request actions">
                  <div>
                    <strong>
                      {canRetry
                        ? 'This request needs operator attention.'
                        : 'Work can still be stopped.'}
                    </strong>
                    <span>Every action is permission-checked and recorded.</span>
                  </div>
                  {canCancel ? (
                    <Button
                      disabled={!online}
                      icon={<Ban size={16} />}
                      onClick={() => setCommand('cancel')}
                      tone="danger"
                    >
                      Cancel request
                    </Button>
                  ) : null}
                  {canRetry ? (
                    <Button
                      disabled={!online}
                      icon={<RotateCcw size={16} />}
                      onClick={() => setCommand('retry')}
                      tone="primary"
                    >
                      Retry request
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <ScrollReveal>
                <div className={styles.detailLayout}>
                  <div className={styles.primaryColumn}>
                    <Panel
                      className={styles.payloadPanel}
                      title="What was requested"
                      description="The information submitted with this request."
                    >
                      <HumanReadablePayload payload={parsed.request.payload} />
                    </Panel>
                    <Panel
                      className={styles.timelinePanel}
                      title="Progress history"
                      description="Every recorded state change, in order."
                    >
                      <QueueRail
                        ariaLabel="Request status timeline"
                        className={styles.timeline}
                        items={requestTimelineItems(parsed)}
                      />
                    </Panel>
                  </div>
                  <Panel
                    className={styles.approvalPanel}
                    title="Approval"
                    description="The decision attached to this request."
                  >
                    {parsed.approval === null ? (
                      <p className="qf-chart-summary">
                        This request type runs without a separate approval.
                      </p>
                    ) : (
                      <dl className="qf-key-values">
                        <dt>Status</dt>
                        <dd>
                          <StatusBadge
                            status={parsed.approval.status}
                            label={
                              parsed.approval.status === 'pending'
                                ? 'Waiting for approval'
                                : parsed.approval.status === 'approved'
                                  ? 'Approved'
                                  : 'Declined'
                            }
                          />
                        </dd>
                        <dt>Requested by</dt>
                        <dd>{parsed.approval.requestedBy}</dd>
                        <dt>Decided by</dt>
                        <dd>{parsed.approval.decidedBy ?? 'Not decided'}</dd>
                        <dt>Note</dt>
                        <dd>{parsed.approval.note ?? 'No note'}</dd>
                      </dl>
                    )}
                  </Panel>
                </div>
              </ScrollReveal>

              <ScrollReveal>
                <details className={`qf-technical-note ${styles.technicalRecord}`}>
                  <summary>
                    <ShieldCheck size={19} aria-hidden="true" />
                    Technical evidence
                  </summary>
                  <div className={styles.technicalGrid}>
                    <dl className="qf-key-values">
                      <dt>Request reference</dt>
                      <dd>
                        <CompactId value={parsed.request.id} />
                      </dd>
                      <dt>Correlation reference</dt>
                      <dd>
                        <CompactId value={parsed.request.correlationId} />
                      </dd>
                      <dt>Configuration version</dt>
                      <dd className="qf-mono">v{parsed.request.versionNo}</dd>
                      <dt>Started from</dt>
                      <dd>{requestSourceLabel(parsed.request.source)}</dd>
                      <dt>Submitted</dt>
                      <dd>
                        <DateTime value={parsed.request.submittedAt} />
                      </dd>
                    </dl>
                    <div>
                      <p>Original payload JSON</p>
                      <pre className="qf-code-block">
                        {JSON.stringify(parsed.request.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                  <p>
                    QueueForge checks every command again on the server against the tenant, role,
                    request policy, and current state.
                  </p>
                </details>
              </ScrollReveal>
            </>
          ) : null}
        </QueryState>
      )}

      <Dialog
        description={
          command === 'cancel'
            ? 'This stops work that has not completed yet and records who stopped it.'
            : 'QueueForge keeps the earlier attempts and starts another safe try.'
        }
        footer={
          <>
            <Button onClick={cancelCommand}>Keep current state</Button>
            <Button
              disabled={!online}
              loading={commandMutation.isPending}
              loadingLabel={command === 'cancel' ? 'Cancelling' : 'Re-queueing'}
              onClick={() => {
                if (command !== null) commandMutation.mutate(command);
              }}
              tone={command === 'cancel' ? 'danger' : 'primary'}
            >
              {command === 'cancel' ? 'Confirm cancellation' : 'Confirm retry'}
            </Button>
          </>
        }
        onClose={cancelCommand}
        open={command !== null}
        title={command === 'cancel' ? 'Cancel this request?' : 'Retry this request?'}
      >
        {commandMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(commandMutation.error)}
          </div>
        ) : null}
        <p>Your action is checked again against the request's latest status before it is saved.</p>
      </Dialog>
    </AppShell>
  );
}

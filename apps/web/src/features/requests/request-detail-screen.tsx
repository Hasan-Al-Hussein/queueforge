'use client';

import { useMemo, useState } from 'react';
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
  type QueueRailItem,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { stripGraphqlTypenames } from '../../api/graphql-response';
import { CompactId, DateTime } from '../../components/format';
import { HumanReadablePayload } from '../../components/human-readable-payload';
import { PageHeader } from '../../components/page-header';
import { QueryState } from '../../components/query-state';
import { RequestDetailSchema, type RequestDetail } from '../../domain/models';
import {
  requestProgressLabel,
  requestSourceLabel,
  requestStatusLabel,
  requestTransitionReasonLabel,
  requestTypeLabel,
} from '../../domain/presentation';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useStaticSearchParam } from '../../hooks/use-static-search-param';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

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

function railItems(detail: RequestDetail): readonly QueueRailItem[] {
  if (detail.transitions.length === 0) {
    return [
      {
        id: detail.request.id,
        label: requestStatusLabel(detail.request.status),
        state: 'current',
        timestamp: detail.request.statusChangedAt,
      },
    ];
  }
  return detail.transitions.map((transition, index) => {
    const isLast = index === detail.transitions.length - 1;
    const failed = ['failed', 'dead_lettered', 'rejected', 'validation_failed'].includes(
      transition.toStatus,
    );
    const description = [
      transition.actorName,
      requestTransitionReasonLabel(transition.reason ?? null),
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(' · ');
    return {
      id: transition.id,
      label: requestStatusLabel(transition.toStatus),
      description: description === '' ? undefined : description,
      state: failed ? 'failed' : isLast ? 'current' : 'complete',
      timestamp: new Date(transition.occurredAt).toLocaleString(),
    };
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
  const commandKey = useIdempotencyKeyLease(`${requestId ?? 'no-request'}:${command ?? 'none'}`);
  const { can, online, session } = useAuth();
  const { notify } = useToast();
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
      <PageHeader
        actions={
          <>
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
            {canCancel ? (
              <Button
                disabled={!online}
                icon={<Ban size={16} />}
                onClick={() => setCommand('cancel')}
                tone="danger"
              >
                Cancel
              </Button>
            ) : null}
            {canRetry ? (
              <Button
                disabled={!online}
                icon={<RotateCcw size={16} />}
                onClick={() => setCommand('retry')}
                tone="primary"
              >
                Retry
              </Button>
            ) : null}
          </>
        }
        description="See what was requested, where it is now, and what happened along the way."
        eyebrow="Request details"
        title={parsed === null ? 'Request' : requestTypeLabel(parsed.request.workflowName)}
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
              <div className="qf-detail-banner">
                <div>
                  <span>Status</span>
                  <StatusBadge
                    status={parsed.request.status}
                    label={requestStatusLabel(parsed.request.status)}
                  />
                </div>
                <div>
                  <span>Request type</span>
                  <strong>{requestTypeLabel(parsed.request.workflowName)}</strong>
                </div>
                <div>
                  <span>Progress</span>
                  <strong>{requestProgressLabel(parsed.request)}</strong>
                </div>
                <div>
                  <span>Submitted</span>
                  <DateTime value={parsed.request.submittedAt} />
                </div>
              </div>
              <div className="qf-content-grid qf-content-grid--detail">
                <Panel
                  title="Progress history"
                  description="A clear, time-ordered record of what happened to this request."
                >
                  <QueueRail items={railItems(parsed)} ariaLabel="Request status timeline" />
                </Panel>
                <div className="qf-content-grid">
                  <Panel title="Request summary">
                    <dl className="qf-key-values">
                      <dt>Request type</dt>
                      <dd>{requestTypeLabel(parsed.request.workflowName)}</dd>
                      <dt>Started from</dt>
                      <dd>{requestSourceLabel(parsed.request.source)}</dd>
                      <dt>Progress</dt>
                      <dd>{requestProgressLabel(parsed.request)}</dd>
                      <dt>Submitted</dt>
                      <dd>
                        <DateTime value={parsed.request.submittedAt} />
                      </dd>
                      <dt>Status changed</dt>
                      <dd>
                        <DateTime value={parsed.request.statusChangedAt} />
                      </dd>
                    </dl>
                  </Panel>
                  <Panel
                    title="Approval"
                    description="Who requested the decision and what the approver decided."
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
                <Panel
                  className="qf-span-full"
                  title="What was requested"
                  description="A readable copy of the information submitted with this request."
                >
                  <HumanReadablePayload payload={parsed.request.payload} />
                  <details className="qf-advanced-disclosure">
                    <summary>Technical JSON</summary>
                    <pre className="qf-code-block">
                      {JSON.stringify(parsed.request.payload, null, 2)}
                    </pre>
                  </details>
                </Panel>
                <details className="qf-span-full qf-technical-note">
                  <summary>
                    <ShieldCheck size={19} aria-hidden="true" />
                    Technical record and security details
                  </summary>
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
                  </dl>
                  <p>
                    QueueForge checks every command again on the server against the tenant, role,
                    request policy, and current state.
                  </p>
                </details>
              </div>
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

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
import { PageHeader } from '../../components/page-header';
import { QueryState } from '../../components/query-state';
import { RequestDetailSchema, type RequestDetail } from '../../domain/models';
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
        label: detail.request.status,
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
    const description = [transition.actorName, transition.reason]
      .filter((value) => value !== null && value !== undefined)
      .join(' · ');
    return {
      id: transition.id,
      label: transition.toStatus,
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
  const { can, online } = useAuth();
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

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Link className="qf-button qf-button--quiet" href="/requests" prefetch={false}>
              <ArrowLeft size={16} />
              All requests
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
        description="Trace the immutable payload, decision gate, and every durable status transition."
        eyebrow="Request inspection"
        title="Request detail"
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
            <Link className="qf-button qf-button--secondary" href="/requests" prefetch={false}>
              Choose a request
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
                  <StatusBadge status={parsed.request.status} />
                </div>
                <div>
                  <span>Request ID</span>
                  <CompactId value={parsed.request.id} />
                </div>
                <div>
                  <span>Correlation ID</span>
                  <CompactId value={parsed.request.correlationId} />
                </div>
                <div>
                  <span>Version</span>
                  <strong className="qf-mono">v{parsed.request.versionNo}</strong>
                </div>
              </div>
              <div className="qf-content-grid qf-content-grid--detail">
                <Panel
                  title="Lifecycle timeline"
                  description="Append-only transitions ordered by occurrence time."
                >
                  <QueueRail items={railItems(parsed)} ariaLabel="Request status timeline" />
                </Panel>
                <div className="qf-content-grid">
                  <Panel title="Request facts">
                    <dl className="qf-key-values">
                      <dt>Workflow</dt>
                      <dd>{parsed.request.workflowName}</dd>
                      <dt>Source</dt>
                      <dd>{parsed.request.source.replaceAll('_', ' ')}</dd>
                      <dt>Attempts</dt>
                      <dd className="qf-mono">
                        {parsed.request.attemptCount} / {parsed.request.maxAttempts}
                      </dd>
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
                    title="Approval binding"
                    description="Decision controls remain server-authoritative."
                  >
                    {parsed.approval === null ? (
                      <p className="qf-chart-summary">
                        This workflow version did not require approval.
                      </p>
                    ) : (
                      <dl className="qf-key-values">
                        <dt>Status</dt>
                        <dd>
                          <StatusBadge status={parsed.approval.status} />
                        </dd>
                        <dt>Requested by</dt>
                        <dd>{parsed.approval.requestedBy}</dd>
                        <dt>Decided by</dt>
                        <dd>{parsed.approval.decidedBy ?? 'Not decided'}</dd>
                        <dt>Revision</dt>
                        <dd className="qf-mono">{parsed.approval.revision}</dd>
                        <dt>Note</dt>
                        <dd>{parsed.approval.note ?? 'No note'}</dd>
                      </dl>
                    )}
                  </Panel>
                </div>
                <Panel
                  className="qf-span-full"
                  title="Immutable payload"
                  description="Captured against the activated workflow version at submission."
                >
                  <pre className="qf-code-block">
                    {JSON.stringify(parsed.request.payload, null, 2)}
                  </pre>
                </Panel>
                <Panel className="qf-span-full" title="Authorization note">
                  <div className="qf-control-note__content">
                    <ShieldCheck size={19} aria-hidden="true" />
                    <p>
                      Controls are shown only when the current role appears eligible. Every command
                      is still re-checked against tenant, role, workflow policy, and current
                      revision by the API.
                    </p>
                  </div>
                </Panel>
              </div>
            </>
          ) : null}
        </QueryState>
      )}

      <Dialog
        description={
          command === 'cancel'
            ? 'Cancellation is recorded as a durable state transition.'
            : 'A manual retry preserves the failed attempt history.'
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
        <p>
          The API requires a fresh idempotency key and will reject stale or illegal transitions.
        </p>
      </Dialog>
    </AppShell>
  );
}

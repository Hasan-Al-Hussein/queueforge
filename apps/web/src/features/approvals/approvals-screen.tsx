'use client';

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm, useWatch } from 'react-hook-form';

import { ApprovalDecisionInputSchema } from '@queueforge/contracts';
import {
  Button,
  Check,
  Dialog,
  Panel,
  RefreshCw,
  ShieldAlert,
  StatusBadge,
  TextareaField,
  X,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { DateTime } from '../../components/format';
import { HumanReadablePayload } from '../../components/human-readable-payload';
import { InlineLoadError } from '../../components/inline-load-error';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { PagedApprovalsSchema, type ApprovalTask } from '../../domain/models';
import { approvalPayloadPreview, requestTypeLabel } from '../../domain/presentation';
import { WorkflowRequestViewSchema } from '@queueforge/contracts';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

interface DecisionForm {
  readonly note?: string;
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

export function ApprovalsScreen(): React.JSX.Element {
  const pagination = usePagination();
  const [selected, setSelected] = useState<{
    readonly decision: 'approved' | 'rejected';
    readonly task: ApprovalTask;
  } | null>(null);
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

  const columns: readonly ColumnDef<ApprovalTask, unknown>[] = [
    {
      accessorKey: 'workflowName',
      header: 'Request type',
      cell: ({ row }) => (
        <div className="qf-decision-summary">
          <Link
            className="qf-table-link"
            href={`/requests/detail?id=${encodeURIComponent(row.original.requestId)}`}
            prefetch={false}
          >
            {requestTypeLabel(row.original.workflowName)}
          </Link>
          <div className="qf-utility">{approvalPayloadPreview(row.original.payloadSummary)}</div>
        </div>
      ),
    },
    { accessorKey: 'requestedByName', header: 'Requested by' },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={
            row.original.status === 'pending'
              ? 'Waiting for you'
              : row.original.status === 'approved'
                ? 'Approved'
                : 'Declined'
          }
        />
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Waiting since',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
    {
      id: 'actions',
      header: 'Your decision',
      enableSorting: false,
      cell: ({ row }) => {
        const selfApproval = session?.user.id === row.original.requestedById;
        const actionable = row.original.status === 'pending' && can('approve') && !selfApproval;
        return (
          <div className="qf-row-actions">
            <Button
              aria-label={`Approve ${requestTypeLabel(row.original.workflowName)}`}
              disabled={!actionable || !online}
              icon={<Check size={15} />}
              onClick={() => setSelected({ decision: 'approved', task: row.original })}
              tone="primary"
              title={selfApproval ? 'Self-approval is forbidden by policy.' : undefined}
            >
              Approve
            </Button>
            <Button
              aria-label={`Decline ${requestTypeLabel(row.original.workflowName)}`}
              disabled={!actionable || !online}
              icon={<X size={15} />}
              onClick={() => setSelected({ decision: 'rejected', task: row.original })}
              tone="quiet"
              title={selfApproval ? 'Self-approval is forbidden by policy.' : undefined}
            >
              Decline
            </Button>
          </div>
        );
      },
    },
  ];
  const rows = approvalsQuery.data?.items ?? [];

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={approvalsQuery.isFetching}
            onClick={() => void approvalsQuery.refetch()}
          >
            Refresh
          </Button>
        }
        description="See who is asking, what they need, and the important details before you decide."
        eyebrow="Your approval workspace"
        title="Decisions waiting for you"
      />
      {!can('approve') ? (
        <div className="qf-inline-alert" role="note">
          <ShieldAlert size={18} aria-hidden="true" />
          <p>This page is read-only for your role. An approver must make the final decision.</p>
        </div>
      ) : null}
      <Panel>
        <QueryState
          empty={approvalsQuery.isSuccess && rows.length === 0}
          emptyDescription="Nothing needs your decision right now. New requests will appear here when they need approval."
          emptyTitle="You are all caught up"
          error={approvalsQuery.error}
          isLoading={approvalsQuery.isLoading}
          onRetry={() => void approvalsQuery.refetch()}
        >
          <DataTable
            ariaLabel="Approval tasks"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            stickyLastColumn
            search={{
              label: 'Search approvals',
              placeholder: 'Request type, person, or detail',
              text: (row) =>
                `${row.workflowName} ${row.requestedByName} ${row.status} ${row.payloadSummary}`,
            }}
          />
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

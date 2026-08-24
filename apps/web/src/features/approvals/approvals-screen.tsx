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
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { PagedApprovalsSchema, type ApprovalTask } from '../../domain/models';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

interface DecisionForm {
  readonly note?: string;
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
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<DecisionForm>({ defaultValues: { note: '' }, mode: 'onBlur' });
  const decisionNote = useWatch({ control, name: 'note' });
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
          ? 'Approval recorded and request queued.'
          : 'Rejection recorded.',
        'success',
      );
      setSelected(null);
      reset();
      await queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
  });
  const submit = handleSubmit(async (values) => {
    if (selected === null) return;
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
      header: 'Request',
      cell: ({ row }) => (
        <div>
          <Link
            className="qf-table-link"
            href={`/requests/detail?id=${encodeURIComponent(row.original.requestId)}`}
            prefetch={false}
          >
            {row.original.workflowName}
          </Link>
          <div className="qf-utility">{row.original.payloadSummary}</div>
        </div>
      ),
    },
    { accessorKey: 'requestedByName', header: 'Requested by' },
    {
      accessorKey: 'status',
      header: 'Decision',
      cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const selfApproval = session?.user.id === row.original.requestedById;
        const actionable = row.original.status === 'pending' && can('approve') && !selfApproval;
        return (
          <div className="qf-row-actions">
            <Button
              aria-label={`Approve ${row.original.workflowName}`}
              disabled={!actionable || !online}
              icon={<Check size={15} />}
              onClick={() => setSelected({ decision: 'approved', task: row.original })}
              tone="quiet"
              title={selfApproval ? 'Self-approval is forbidden by policy.' : undefined}
            />
            <Button
              aria-label={`Reject ${row.original.workflowName}`}
              disabled={!actionable || !online}
              icon={<X size={15} />}
              onClick={() => setSelected({ decision: 'rejected', task: row.original })}
              tone="quiet"
              title={selfApproval ? 'Self-approval is forbidden by policy.' : undefined}
            />
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
        description="Make attributable decisions against the exact request, workflow version, payload hash, and revision."
        eyebrow="Human gate"
        title="Approvals"
      />
      {!can('approve') ? (
        <div className="qf-inline-alert" role="note">
          <ShieldAlert size={18} aria-hidden="true" />
          <p>
            Your role may inspect approval history but cannot decide. The server independently
            enforces this permission.
          </p>
        </div>
      ) : null}
      <Panel>
        <QueryState
          empty={approvalsQuery.isSuccess && rows.length === 0}
          emptyDescription="There are no approval tasks for this tenant. Requests that bypass approval move directly to the queue."
          emptyTitle="Approval queue is clear"
          error={approvalsQuery.error}
          isLoading={approvalsQuery.isLoading}
          onRetry={() => void approvalsQuery.refetch()}
        >
          <DataTable
            ariaLabel="Approval tasks"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            search={{
              label: 'Search approvals',
              placeholder: 'Workflow, requester, or status',
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
            : `${selected.decision === 'approved' ? 'Approve' : 'Reject'} ${selected.task.workflowName}, requested by ${selected.task.requestedByName}.`
        }
        footer={
          <>
            <Button onClick={cancelDecision}>Cancel</Button>
            <Button
              disabled={!online}
              loading={decisionMutation.isPending}
              loadingLabel="Recording"
              onClick={() => void submit()}
              tone={selected?.decision === 'rejected' ? 'danger' : 'primary'}
            >
              Record {selected?.decision === 'rejected' ? 'rejection' : 'approval'}
            </Button>
          </>
        }
        onClose={cancelDecision}
        open={selected !== null}
        title={selected?.decision === 'rejected' ? 'Reject this request?' : 'Approve this request?'}
      >
        {decisionMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(decisionMutation.error)}
          </div>
        ) : null}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <TextareaField
            error={errors.note?.message}
            helper="Optional context for the audit trail (2,000 characters maximum)."
            id="approval-note"
            label="Decision note"
            maxLength={2000}
            {...register('note')}
          />
        </form>
      </Dialog>
    </AppShell>
  );
}

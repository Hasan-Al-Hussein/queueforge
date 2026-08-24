'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import type { WorkflowSummary } from '@queueforge/contracts';
import {
  Button,
  Dialog,
  GitBranchPlus,
  InputField,
  Panel,
  Plus,
  RefreshCw,
  StatusBadge,
  TextareaField,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { WorkflowDetailSchema, WorkflowListSchema } from '../../domain/models';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

const CreateWorkflowSchema = z.object({
  description: z.string().max(2000).optional(),
  name: z.string().trim().min(1).max(160),
  stableKey: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, numbers, underscores, or dashes.'),
});
type CreateWorkflow = z.infer<typeof CreateWorkflowSchema>;

const columns: readonly ColumnDef<WorkflowSummary, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Workflow',
    cell: ({ row }) => (
      <div>
        <Link
          className="qf-table-link"
          href={`/workflows/editor?id=${encodeURIComponent(row.original.id)}`}
          prefetch={false}
        >
          {row.original.name}
        </Link>
        <div className="qf-mono qf-utility">{row.original.stableKey}</div>
      </div>
    ),
  },
  {
    accessorKey: 'versionNo',
    header: 'Version',
    cell: ({ getValue }) => <span className="qf-mono">v{String(getValue())}</span>,
  },
  {
    accessorKey: 'versionStatus',
    header: 'State',
    cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
  },
  {
    accessorKey: 'requiresApproval',
    header: 'Approval',
    cell: ({ getValue }) => (getValue() === true ? 'Required' : 'Bypassed'),
  },
  {
    accessorKey: 'isEnabled',
    header: 'Intake',
    cell: ({ getValue }) => (
      <StatusBadge
        status={getValue() === true ? 'active' : 'retired'}
        label={getValue() === true ? 'enabled' : 'disabled'}
      />
    ),
  },
  {
    accessorKey: 'revision',
    header: 'Revision',
    cell: ({ getValue }) => <span className="qf-mono">r{String(getValue())}</span>,
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
];

export function WorkflowsScreen(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();
  const { online } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: ({ signal }) => apiRequest(routes.workflows, { schema: WorkflowListSchema, signal }),
  });
  const {
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
  } = useForm<CreateWorkflow>({
    defaultValues: { description: '', name: '', stableKey: '' },
    mode: 'onBlur',
    resolver: zodResolver(CreateWorkflowSchema),
  });
  const workflowInput = useWatch({ control });
  const workflowCreationKey = useIdempotencyKeyLease(JSON.stringify(workflowInput));
  const createMutation = useMutation({
    mutationFn: (input: CreateWorkflow) =>
      apiRequest(routes.workflows, {
        body: input,
        idempotencyKey: workflowCreationKey.acquire(),
        method: 'POST',
        schema: WorkflowDetailSchema,
      }),
    onSuccess: async (workflow) => {
      workflowCreationKey.clear();
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      notify('Draft workflow created.', 'success');
      reset();
      setCreateOpen(false);
      router.push(`/workflows/editor?id=${encodeURIComponent(workflow.id)}`);
    },
  });
  const submit = handleSubmit(async (values) => createMutation.mutateAsync(values));
  const cancelCreation = (): void => {
    workflowCreationKey.clear();
    createMutation.reset();
    setCreateOpen(false);
  };
  const rows = workflowsQuery.data ?? [];

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw size={16} />}
              loading={workflowsQuery.isFetching}
              onClick={() => void workflowsQuery.refetch()}
            >
              Refresh
            </Button>
            <PermissionGate permission="configure_workflows">
              <Button
                disabled={!online}
                icon={<Plus size={16} />}
                onClick={() => setCreateOpen(true)}
                tone="primary"
              >
                New workflow
              </Button>
            </PermissionGate>
          </>
        }
        description="Draft, validate, and activate immutable workflow versions for this tenant."
        eyebrow="Versioned configuration"
        title="Workflows"
      />
      <Panel>
        <QueryState
          empty={workflowsQuery.isSuccess && rows.length === 0}
          emptyAction={
            <PermissionGate permission="configure_workflows">
              <Button icon={<GitBranchPlus size={16} />} onClick={() => setCreateOpen(true)}>
                Create a draft
              </Button>
            </PermissionGate>
          }
          emptyDescription="Create a draft, define its JSON request schema and processing policy, then activate an immutable version."
          emptyTitle="No workflows configured"
          error={workflowsQuery.error}
          isLoading={workflowsQuery.isLoading}
          onRetry={() => void workflowsQuery.refetch()}
        >
          <DataTable
            ariaLabel="Workflow catalog"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            search={{
              label: 'Search workflows',
              placeholder: 'Name, key, or version state',
              text: (row) => `${row.name} ${row.stableKey} ${row.versionStatus}`,
            }}
          />
        </QueryState>
      </Panel>

      <Dialog
        description="This creates revision 1 as a mutable draft. Activation makes the version content immutable."
        footer={
          <>
            <Button onClick={cancelCreation}>Cancel</Button>
            <Button
              disabled={!online}
              loading={isSubmitting || createMutation.isPending}
              loadingLabel="Creating"
              onClick={() => void submit()}
              tone="primary"
            >
              Create draft
            </Button>
          </>
        }
        onClose={cancelCreation}
        open={createOpen}
        title="Create workflow"
      >
        {createMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(createMutation.error)}
          </div>
        ) : null}
        <form className="qf-form-stack" onSubmit={(event) => void submit(event)} noValidate>
          <InputField
            error={errors.name?.message}
            id="workflow-name"
            label="Workflow name"
            required
            {...register('name')}
          />
          <InputField
            error={errors.stableKey?.message}
            helper="External submissions use this stable key."
            id="workflow-key"
            label="Stable key"
            required
            {...register('stableKey')}
          />
          <TextareaField
            error={errors.description?.message}
            id="workflow-description"
            label="Description"
            maxLength={2000}
            {...register('description')}
          />
        </form>
      </Dialog>
    </AppShell>
  );
}

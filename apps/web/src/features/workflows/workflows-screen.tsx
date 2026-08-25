'use client';

import { useState, type ChangeEvent } from 'react';
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
        <div className="qf-utility">{row.original.description ?? 'No description yet'}</div>
      </div>
    ),
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
    setValue,
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
        description="Create friendly request forms, choose approvals, and decide what happens next."
        eyebrow="Set up how work flows"
        title="Workflow builder"
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
          emptyDescription="Create your first workflow, add the questions people should answer, then turn it on."
          emptyTitle="No workflows yet"
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
        description="Give the workflow a clear name. You will build its request form on the next screen."
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
        title="Create a new workflow"
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
            {...register('name', {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                const value = event.target.value
                  .trim()
                  .toLowerCase()
                  .replaceAll(/[^a-z0-9]+/g, '_')
                  .replaceAll(/^_+|_+$/g, '')
                  .slice(0, 100);
                setValue('stableKey', value, { shouldValidate: true });
              },
            })}
          />
          <TextareaField
            error={errors.description?.message}
            helper="Explain when someone should use this workflow."
            id="workflow-description"
            label="What is this workflow for?"
            maxLength={2000}
            {...register('description')}
          />
          <details className="qf-advanced-disclosure">
            <summary>Advanced identifier</summary>
            <InputField
              error={errors.stableKey?.message}
              helper="Generated automatically. APIs use this stable key."
              id="workflow-key"
              label="Stable key"
              required
              {...register('stableKey')}
            />
          </details>
        </form>
      </Dialog>
    </AppShell>
  );
}

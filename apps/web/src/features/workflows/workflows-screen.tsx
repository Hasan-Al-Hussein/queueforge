'use client';

import { useMemo, useState, type ChangeEvent } from 'react';
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
import { ScrollReveal } from '../../components/cinematic-motion';
import { DataTable } from '../../components/data-table';
import { DateTime } from '../../components/format';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { HeroMetrics, RouteHero } from '../../components/route-hero';
import { WorkflowDetailSchema, WorkflowListSchema } from '../../domain/models';
import { isSystemCheckWorkflow, requestTypeLabel } from '../../domain/presentation';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import styles from './workflows-screen.module.css';

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
type CatalogFilter = 'all' | 'archived' | 'draft' | 'live';

const CATALOG_FILTERS: readonly { readonly label: string; readonly value: CatalogFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Live', value: 'live' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Archived', value: 'archived' },
];

const columns: readonly ColumnDef<WorkflowSummary, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Request type',
    cell: ({ row }) => (
      <div>
        <Link
          className="qf-table-link"
          href={`/workflows/editor?id=${encodeURIComponent(row.original.id)}`}
          prefetch={false}
        >
          {requestTypeLabel(row.original.name)}
        </Link>
        <div className="qf-utility">{row.original.description ?? 'No description yet'}</div>
      </div>
    ),
  },
  {
    accessorKey: 'versionStatus',
    header: 'Setup status',
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.versionStatus}
        label={
          row.original.versionStatus === 'active'
            ? 'Live'
            : row.original.versionStatus === 'draft'
              ? 'Draft'
              : 'Archived'
        }
      />
    ),
  },
  {
    accessorKey: 'requiresApproval',
    header: 'Decision step',
    cell: ({ getValue }) => (getValue() === true ? 'Approval required' : 'Runs automatically'),
  },
  {
    accessorKey: 'isEnabled',
    header: 'Availability',
    cell: ({ getValue }) => (
      <StatusBadge
        status={getValue() === true ? 'active' : 'retired'}
        label={getValue() === true ? 'Accepting requests' : 'Paused'}
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
  const [showSystemChecks, setShowSystemChecks] = useState(false);
  const [catalogFilter, setCatalogFilter] = useState<CatalogFilter>('all');
  const router = useRouter();
  const { can, online } = useAuth();
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
      notify('Request type draft created.', 'success');
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
  const allRows = useMemo(() => workflowsQuery.data ?? [], [workflowsQuery.data]);
  const systemCheckRows = useMemo(
    () => allRows.filter((workflow) => isSystemCheckWorkflow(workflow)),
    [allRows],
  );
  const businessRows = useMemo(
    () => allRows.filter((workflow) => !isSystemCheckWorkflow(workflow)),
    [allRows],
  );
  const visibleCatalog = showSystemChecks ? allRows : businessRows;
  const rows = useMemo(
    () =>
      visibleCatalog.filter((workflow) => {
        if (catalogFilter === 'all') return true;
        if (catalogFilter === 'live')
          return workflow.versionStatus === 'active' && workflow.isEnabled;
        return workflow.versionStatus === catalogFilter;
      }),
    [catalogFilter, visibleCatalog],
  );
  const dataReady = workflowsQuery.data !== undefined;
  const approvalCount = businessRows.filter((workflow) => workflow.requiresApproval).length;
  const liveCount = businessRows.filter(
    (workflow) => workflow.versionStatus === 'active' && workflow.isEnabled,
  ).length;
  const draftCount = businessRows.filter((workflow) => workflow.versionStatus === 'draft').length;

  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
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
                  New request type
                </Button>
              </PermissionGate>
            </>
          }
          description={
            can('configure_workflows')
              ? 'Create and publish the request forms, approval rules, and processing paths your team uses.'
              : 'See the request types currently available and how each one is configured.'
          }
          eyebrow={
            can('configure_workflows') ? 'Workspace configuration' : 'Configuration reference'
          }
          icon={<GitBranchPlus size={18} />}
          meta={
            dataReady
              ? `${String(businessRows.length)} request type${businessRows.length === 1 ? '' : 's'} · ${String(systemCheckRows.length)} system check${systemCheckRows.length === 1 ? '' : 's'} hidden`
              : 'Loading request types…'
          }
          title="Request types"
          visual={
            <HeroMetrics
              items={[
                { label: 'Configured', value: dataReady ? businessRows.length : '…' },
                { label: 'Live', tone: 'signal', value: dataReady ? liveCount : '…' },
                {
                  label: 'Approval gates',
                  tone: 'warning',
                  value: dataReady ? approvalCount : '…',
                },
                { label: 'Drafts', value: dataReady ? draftCount : '…' },
              ]}
            />
          }
        />

        <ScrollReveal amount={0.1}>
          <Panel
            className={styles.catalogPanel}
            title="Request types"
            description="Open a request type to inspect or change its form, approval rule, and processing path."
            actions={
              <span className={styles.draftCount}>
                {dataReady
                  ? `${String(draftCount)} draft${draftCount === 1 ? '' : 's'}`
                  : 'Loading…'}
              </span>
            }
          >
            <div className={styles.catalogToolbar}>
              <div className={styles.catalogTabs} aria-label="Filter request types" role="group">
                {CATALOG_FILTERS.map((filter) => (
                  <button
                    aria-pressed={catalogFilter === filter.value}
                    key={filter.value}
                    onClick={() => setCatalogFilter(filter.value)}
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <span>{dataReady ? `${String(rows.length)} shown` : 'Loading request types…'}</span>
            </div>
            {systemCheckRows.length === 0 ? null : (
              <div className="qf-catalog-note" role="note">
                <div>
                  <strong>System checks are hidden from the main catalog</strong>
                  <p>
                    {String(systemCheckRows.length)} automated recovery test
                    {systemCheckRows.length === 1 ? '' : 's'} are hidden so the request types your
                    team actually uses stay easy to find.
                  </p>
                </div>
                <Button onClick={() => setShowSystemChecks((current) => !current)} tone="quiet">
                  {showSystemChecks ? 'Hide system checks' : 'Show system checks'}
                </Button>
              </div>
            )}
            <QueryState
              empty={workflowsQuery.isSuccess && rows.length === 0}
              emptyAction={
                <PermissionGate permission="configure_workflows">
                  <Button icon={<GitBranchPlus size={16} />} onClick={() => setCreateOpen(true)}>
                    Create a request type
                  </Button>
                </PermissionGate>
              }
              emptyDescription={
                catalogFilter === 'all'
                  ? 'Create a request type, add the questions people should answer, then make it available.'
                  : 'No request types match this status. Choose another tab or create a new draft.'
              }
              emptyTitle={
                catalogFilter === 'all' ? 'No request types yet' : 'No matches in this view'
              }
              error={workflowsQuery.error}
              isLoading={workflowsQuery.isLoading}
              onRetry={() => void workflowsQuery.refetch()}
            >
              <DataTable
                ariaLabel="Request types"
                columns={columns}
                getRowId={(row) => row.id}
                rows={rows}
                search={{
                  label: 'Search request types',
                  placeholder: 'Name, purpose, or setup status',
                  text: (row) => `${row.name} ${row.stableKey} ${row.versionStatus}`,
                }}
              />
            </QueryState>
          </Panel>
        </ScrollReveal>
      </div>

      <Dialog
        description="Give this request type a clear name. You will choose its questions on the next screen."
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
        title="Create a request type"
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
            label="Request type name"
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
            helper="Explain when someone should use this request type."
            id="workflow-description"
            label="When should someone use this?"
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

'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import {
  Button,
  Dialog,
  InputField,
  Panel,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  StatusBadge,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DataTable } from '../../components/data-table';
import { CompactId, DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import {
  CreatedWebhookEndpointSchema,
  PagedDeliveriesSchema,
  WebhookEndpointListSchema,
  type WebhookDelivery,
  type WebhookEndpoint,
} from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

const EndpointFormSchema = z.object({
  keyId: z.string().trim().min(2).max(80),
  name: z.string().trim().min(1).max(160),
  url: z
    .string()
    .url()
    .refine(
      (value) => ['http:', 'https:'].includes(new URL(value).protocol),
      'Use an http or https URL.',
    ),
});
type EndpointForm = z.infer<typeof EndpointFormSchema>;

interface CreatedEndpointNotice {
  readonly endpointName: string;
  readonly replayed: boolean;
  readonly signingSecret: string | null;
}

const endpointColumns: readonly ColumnDef<WebhookEndpoint, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Endpoint',
    cell: ({ row }) => (
      <div>
        <strong>{row.original.name}</strong>
        <div className="qf-utility qf-break-all">{row.original.url}</div>
      </div>
    ),
  },
  {
    accessorKey: 'active',
    header: 'State',
    cell: ({ getValue }) => <StatusBadge status={getValue() === true ? 'active' : 'retired'} />,
  },
  {
    accessorKey: 'keyId',
    header: 'Signing key',
    cell: ({ getValue }) => <code>{String(getValue())}</code>,
  },
  {
    accessorKey: 'updatedAt',
    header: 'Updated',
    cell: ({ getValue }) => <DateTime value={String(getValue())} />,
  },
];

export function WebhooksScreen(): React.JSX.Element {
  const deliveryPagination = usePagination();
  const [tab, setTab] = useState<'endpoints' | 'deliveries'>('deliveries');
  const [createOpen, setCreateOpen] = useState(false);
  const [replayDelivery, setReplayDelivery] = useState<WebhookDelivery | null>(null);
  const [createdEndpointNotice, setCreatedEndpointNotice] = useState<CreatedEndpointNotice | null>(
    null,
  );
  const { online } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const endpointQuery = useQuery({
    queryKey: ['webhook-endpoints'],
    queryFn: ({ signal }) =>
      apiRequest(routes.webhookEndpoints, { schema: WebhookEndpointListSchema, signal }),
  });
  const deliveryQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['webhook-deliveries', deliveryPagination.page, deliveryPagination.pageSize],
    queryFn: ({ signal }) =>
      apiRequest(`${routes.webhookDeliveries}?${pageSearchParams(deliveryPagination).toString()}`, {
        schema: PagedDeliveriesSchema,
        signal,
      }),
  });
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    reset,
  } = useForm<EndpointForm>({
    defaultValues: { keyId: 'local-v1', name: '', url: '' },
    mode: 'onBlur',
    resolver: zodResolver(EndpointFormSchema),
  });
  const endpointInput = useWatch({ control });
  const endpointCreationKey = useIdempotencyKeyLease(JSON.stringify(endpointInput));
  const replayKey = useIdempotencyKeyLease(replayDelivery?.id ?? 'no-delivery-selected');
  const createMutation = useMutation({
    mutationFn: (input: EndpointForm) =>
      apiRequest(routes.webhookEndpoints, {
        body: input,
        idempotencyKey: endpointCreationKey.acquire(),
        method: 'POST',
        schema: CreatedWebhookEndpointSchema,
      }),
    onSuccess: async (result) => {
      endpointCreationKey.clear();
      notify('Webhook endpoint created.', 'success');
      setCreatedEndpointNotice({
        endpointName: result.endpoint.name,
        replayed: result.replayed,
        signingSecret: result.signingSecret,
      });
      reset();
      setCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['webhook-endpoints'] });
    },
  });
  const replayMutation = useMutation({
    mutationFn: (delivery: WebhookDelivery) =>
      apiRequest<unknown>(routes.replayWebhookDelivery(delivery.id), {
        idempotencyKey: replayKey.acquire(),
        method: 'POST',
      }),
    onSuccess: async () => {
      replayKey.clear();
      notify('Delivery replay queued with a new generation.', 'success');
      setReplayDelivery(null);
      deliveryPagination.resetPage();
      await queryClient.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    },
  });
  const submitEndpoint = handleSubmit(async (values) => createMutation.mutateAsync(values));
  const cancelEndpointCreation = (): void => {
    endpointCreationKey.clear();
    createMutation.reset();
    setCreateOpen(false);
  };
  const cancelReplay = (): void => {
    replayKey.clear();
    replayMutation.reset();
    setReplayDelivery(null);
  };
  const deliveries = deliveryQuery.data?.items ?? [];
  const deliveryColumns: readonly ColumnDef<WebhookDelivery, unknown>[] = [
    {
      accessorKey: 'eventType',
      header: 'Event',
      cell: ({ row }) => (
        <div>
          <strong>{row.original.eventType}</strong>
          <div>
            <CompactId value={row.original.eventId} />
          </div>
        </div>
      ),
    },
    { accessorKey: 'endpointName', header: 'Endpoint' },
    {
      accessorKey: 'status',
      header: 'State',
      cell: ({ getValue }) => <StatusBadge status={String(getValue())} />,
    },
    {
      accessorKey: 'attemptCount',
      header: 'Attempts',
      cell: ({ getValue }) => <span className="qf-mono">{String(getValue())}</span>,
    },
    {
      accessorKey: 'lastStatusCode',
      header: 'HTTP',
      cell: ({ getValue }) => (
        <span className="qf-mono">{getValue() === null ? '—' : String(getValue())}</span>
      ),
    },
    {
      accessorKey: 'nextAttemptAt',
      header: 'Next attempt',
      cell: ({ getValue }) =>
        getValue() === null ? (
          <span aria-label="Not scheduled">—</span>
        ) : (
          <DateTime value={String(getValue())} />
        ),
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      cell: ({ getValue }) => <DateTime value={String(getValue())} />,
    },
    {
      id: 'replay',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => (
        <PermissionGate permission="replay">
          <Button
            aria-label={`Replay delivery ${row.original.eventId}`}
            disabled={!online}
            icon={<RotateCcw size={15} />}
            onClick={() => setReplayDelivery(row.original)}
            tone="quiet"
          />
        </PermissionGate>
      ),
    },
  ];

  return (
    <AppShell>
      <PageHeader
        actions={
          <>
            <Button
              icon={<RefreshCw size={16} />}
              loading={endpointQuery.isFetching || deliveryQuery.isFetching}
              onClick={() => {
                void endpointQuery.refetch();
                void deliveryQuery.refetch();
              }}
            >
              Refresh
            </Button>
            <PermissionGate permission="configure_webhooks">
              <Button
                disabled={!online}
                icon={<Plus size={16} />}
                onClick={() => setCreateOpen(true)}
                tone="primary"
              >
                Add endpoint
              </Button>
            </PermissionGate>
          </>
        }
        description="Configure allowlisted signed targets and inspect each at-least-once delivery attempt."
        eyebrow="Signed egress"
        title="Webhooks"
      />
      <div className="qf-inline-alert" role="note">
        <ShieldCheck size={18} />
        <p>
          Redirects are disabled. The worker resolves and rechecks the exact local allowlist before
          every attempt; signing secrets are shown once at creation and encrypted at rest.
        </p>
      </div>
      <Panel>
        <div className="qf-segmented" role="tablist" aria-label="Webhook surfaces">
          <button
            aria-controls="webhook-deliveries-panel"
            aria-selected={tab === 'deliveries'}
            id="webhook-deliveries-tab"
            onClick={() => setTab('deliveries')}
            role="tab"
            type="button"
          >
            Deliveries
          </button>
          <button
            aria-controls="webhook-endpoints-panel"
            aria-selected={tab === 'endpoints'}
            id="webhook-endpoints-tab"
            onClick={() => setTab('endpoints')}
            role="tab"
            type="button"
          >
            Endpoints
          </button>
        </div>
        {tab === 'deliveries' ? (
          <div
            aria-labelledby="webhook-deliveries-tab"
            id="webhook-deliveries-panel"
            role="tabpanel"
          >
            <QueryState
              empty={deliveryQuery.isSuccess && deliveries.length === 0}
              emptyDescription="No outbound event has created a delivery record for this tenant."
              emptyTitle="No deliveries yet"
              error={deliveryQuery.error}
              isLoading={deliveryQuery.isLoading}
              onRetry={() => void deliveryQuery.refetch()}
            >
              <DataTable
                ariaLabel="Outbound webhook deliveries"
                columns={deliveryColumns}
                getRowId={(row) => row.id}
                rows={deliveries}
                search={{
                  label: 'Search deliveries',
                  placeholder: 'Event, endpoint, or state',
                  text: (row) =>
                    `${row.eventType} ${row.eventId} ${row.endpointName} ${row.status}`,
                }}
              />
            </QueryState>
            {deliveryQuery.data?.meta === undefined ? null : (
              <PaginationControls
                ariaLabel="Webhook deliveries"
                disabled={deliveryQuery.isFetching}
                meta={deliveryQuery.data.meta}
                onPageChange={deliveryPagination.setPage}
                onPageSizeChange={deliveryPagination.setPageSize}
                page={deliveryPagination.page}
                pageSize={deliveryPagination.pageSize}
              />
            )}
          </div>
        ) : (
          <div aria-labelledby="webhook-endpoints-tab" id="webhook-endpoints-panel" role="tabpanel">
            <QueryState
              empty={endpointQuery.isSuccess && endpointQuery.data.length === 0}
              emptyDescription="Add an allowlisted local receiver before activating workflows that emit outbound webhooks."
              emptyTitle="No webhook endpoints"
              error={endpointQuery.error}
              isLoading={endpointQuery.isLoading}
              onRetry={() => void endpointQuery.refetch()}
            >
              <DataTable
                ariaLabel="Webhook endpoints"
                columns={endpointColumns}
                getRowId={(row) => row.id}
                rows={endpointQuery.data ?? []}
                search={{
                  label: 'Search endpoints',
                  placeholder: 'Name, URL, or key ID',
                  text: (row) => `${row.name} ${row.url} ${row.keyId}`,
                }}
              />
            </QueryState>
          </div>
        )}
      </Panel>

      <Dialog
        description="The server validates protocol, resolves the hostname, and enforces the configured local allowlist."
        footer={
          <>
            <Button onClick={cancelEndpointCreation}>Cancel</Button>
            <Button
              disabled={!online}
              loading={createMutation.isPending}
              loadingLabel="Creating"
              onClick={() => void submitEndpoint()}
              tone="primary"
            >
              Create endpoint
            </Button>
          </>
        }
        onClose={cancelEndpointCreation}
        open={createOpen}
        title="Add webhook endpoint"
      >
        {createMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(createMutation.error)}
          </div>
        ) : null}
        <form className="qf-form-stack" onSubmit={(event) => void submitEndpoint(event)} noValidate>
          <InputField
            error={errors.name?.message}
            id="endpoint-name"
            label="Endpoint name"
            required
            {...register('name')}
          />
          <InputField
            error={errors.url?.message}
            helper="Host-first: http://127.0.0.1:3300/webhooks. Full Compose: http://webhook-sink:3300/webhooks."
            id="endpoint-url"
            label="Target URL"
            required
            type="url"
            {...register('url')}
          />
          <InputField
            error={errors.keyId?.message}
            helper="Version identifier only; secret material is managed server-side."
            id="endpoint-key-id"
            label="Signing key ID"
            required
            {...register('keyId')}
          />
        </form>
      </Dialog>

      <Dialog
        description={
          createdEndpointNotice?.signingSecret === null
            ? 'The retained idempotency key recovered the committed endpoint, but one-time secret material cannot be replayed.'
            : 'Copy this secret now. QueueForge will not reveal it again, including on an idempotent replay.'
        }
        footer={
          <Button onClick={() => setCreatedEndpointNotice(null)} tone="primary">
            {createdEndpointNotice?.signingSecret === null ? 'I understand' : 'I saved the secret'}
          </Button>
        }
        onClose={() => setCreatedEndpointNotice(null)}
        open={createdEndpointNotice !== null}
        title={
          createdEndpointNotice?.signingSecret === null
            ? 'Signing secret cannot be recovered'
            : 'Webhook signing secret'
        }
      >
        {createdEndpointNotice?.signingSecret === null ? (
          <div className="qf-inline-alert" role="alert">
            <ShieldCheck size={18} />
            <p>
              The endpoint <strong>{createdEndpointNotice.endpointName}</strong> was committed, but
              its one-time secret was returned to an earlier response that did not reach this tab
              {createdEndpointNotice.replayed ? ' and this was an idempotent recovery.' : '.'}{' '}
              Create a replacement signing endpoint before using it; QueueForge will never reveal
              the committed secret again.
            </p>
          </div>
        ) : (
          <div className="qf-form-stack">
            <div className="qf-inline-alert" role="status">
              <ShieldCheck size={18} />
              <code className="qf-break-all">{createdEndpointNotice?.signingSecret}</code>
            </div>
            <p>
              Configure the receiver with this secret before activating a workflow that targets it.
              The bundled demo sink is preconfigured only for the seeded endpoint; it does not
              automatically register newly generated secrets.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        description="Replay creates a new delivery generation while preserving the original attempt history."
        footer={
          <>
            <Button onClick={cancelReplay}>Cancel</Button>
            <Button
              disabled={!online}
              loading={replayMutation.isPending}
              loadingLabel="Queueing replay"
              onClick={() => {
                if (replayDelivery !== null) replayMutation.mutate(replayDelivery);
              }}
              tone="primary"
            >
              Queue replay
            </Button>
          </>
        }
        onClose={cancelReplay}
        open={replayDelivery !== null}
        title="Replay this webhook delivery?"
      >
        {replayMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(replayMutation.error)}
          </div>
        ) : null}
        <p>
          The stable event ID remains visible to the receiver so it can apply its own idempotency
          policy.
        </p>
      </Dialog>
    </AppShell>
  );
}

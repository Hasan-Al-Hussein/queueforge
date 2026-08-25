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
  SegmentedTabs,
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
import { requestTypeLabel } from '../../domain/presentation';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useIdempotencyKeyLease } from '../../hooks/use-idempotency-key-lease';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import {
  deliveryAttemptLabel,
  nextDeliveryAttemptAt,
  receiverReplyLabel,
  webhookDeliveryStatusLabel,
  webhookEventLabel,
} from './delivery-presentation';

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
    header: 'Connection',
    cell: ({ row }) => (
      <div>
        <strong>{row.original.name}</strong>
        <div className="qf-utility qf-break-all">{row.original.url}</div>
      </div>
    ),
  },
  {
    accessorKey: 'active',
    header: 'Availability',
    cell: ({ getValue }) => (
      <StatusBadge
        status={getValue() === true ? 'active' : 'retired'}
        label={getValue() === true ? 'Ready to receive' : 'Turned off'}
      />
    ),
  },
  {
    accessorKey: 'keyId',
    header: 'Security',
    cell: ({ getValue }) => (
      <details className="qf-advanced-disclosure">
        <summary>Signing details</summary>
        <div className="qf-utility">
          Key reference: <code>{String(getValue())}</code>
        </div>
      </details>
    ),
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
      notify('Connection created.', 'success');
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
      notify('Another delivery try has been queued.', 'success');
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
      accessorKey: 'endpointName',
      header: 'Destination',
      cell: ({ row }) => (
        <div>
          <strong>{row.original.endpointName}</strong>
          <div className="qf-utility">{webhookEventLabel(row.original.eventType)}</div>
          <details className="qf-advanced-disclosure">
            <summary>Technical details</summary>
            <div className="qf-utility">
              Event code: <code>{row.original.eventType}</code>
            </div>
            <div>
              Event reference: <CompactId value={row.original.eventId} />
            </div>
          </details>
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Delivery status',
      cell: ({ row }) => {
        const nextAttemptAt = nextDeliveryAttemptAt(row.original);
        return (
          <div>
            <StatusBadge
              status={row.original.status}
              label={webhookDeliveryStatusLabel(row.original.status)}
            />
            {nextAttemptAt === null ? null : (
              <div className="qf-utility">
                Next try <DateTime value={nextAttemptAt} />
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'request',
      header: 'Related request',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.requestId === null && row.original.workflowName === null ? (
          <span className="qf-utility">System update · no request linked</span>
        ) : (
          <div>
            <strong>
              {row.original.workflowName === null
                ? 'Request'
                : requestTypeLabel(row.original.workflowName)}
            </strong>
            {row.original.requestId === null ? null : (
              <div>
                Reference: <CompactId value={row.original.requestId} />
              </div>
            )}
          </div>
        ),
    },
    {
      accessorKey: 'attemptCount',
      header: 'Tries',
      cell: ({ getValue }) => deliveryAttemptLabel(Number(getValue())),
    },
    {
      accessorKey: 'lastStatusCode',
      header: 'Receiver reply',
      cell: ({ getValue }) => receiverReplyLabel(getValue() === null ? null : Number(getValue())),
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
            disabled={!online}
            icon={<RotateCcw size={15} />}
            onClick={() => setReplayDelivery(row.original)}
            tone="quiet"
          >
            Try again
          </Button>
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
                Add connection
              </Button>
            </PermissionGate>
          </>
        }
        description="Choose where completed results are sent and see whether each destination received them."
        eyebrow="Send results to other systems"
        title="Integrations"
      />
      <div className="qf-inline-alert" role="note">
        <ShieldCheck size={18} />
        <p>
          QueueForge sends results only to approved local addresses. New connections use a secret so
          the receiving system can verify that each result really came from QueueForge.
        </p>
      </div>
      <Panel>
        <SegmentedTabs
          ariaLabel="Integration sections"
          onValueChange={setTab}
          options={[
            { label: 'Delivery history', value: 'deliveries' },
            { label: 'Connections', value: 'endpoints' },
          ]}
          value={tab}
        >
          {tab === 'deliveries' ? (
            <>
              <QueryState
                empty={deliveryQuery.isSuccess && deliveries.length === 0}
                emptyDescription="Completed requests will appear here after QueueForge sends their results to a connected system."
                emptyTitle="Nothing has been sent yet"
                error={deliveryQuery.error}
                isLoading={deliveryQuery.isLoading}
                onRetry={() => void deliveryQuery.refetch()}
              >
                <DataTable
                  ariaLabel="Result delivery history"
                  columns={deliveryColumns}
                  getRowId={(row) => row.id}
                  rows={deliveries}
                  search={{
                    label: 'Search delivery history',
                    placeholder: 'Destination, update, or status',
                    text: (row) =>
                      `${webhookEventLabel(row.eventType)} ${row.eventType} ${row.eventId} ${row.endpointName} ${row.workflowName ?? ''} ${row.requestId ?? ''} ${webhookDeliveryStatusLabel(row.status)}`,
                  }}
                  stickyLastColumn
                />
              </QueryState>
              {deliveryQuery.data?.meta === undefined ? null : (
                <PaginationControls
                  ariaLabel="Result deliveries"
                  disabled={deliveryQuery.isFetching}
                  meta={deliveryQuery.data.meta}
                  onPageChange={deliveryPagination.setPage}
                  onPageSizeChange={deliveryPagination.setPageSize}
                  page={deliveryPagination.page}
                  pageSize={deliveryPagination.pageSize}
                />
              )}
            </>
          ) : (
            <>
              <QueryState
                empty={endpointQuery.isSuccess && endpointQuery.data.length === 0}
                emptyDescription="Add the local system that should receive completed results."
                emptyTitle="No connections yet"
                error={endpointQuery.error}
                isLoading={endpointQuery.isLoading}
                onRetry={() => void endpointQuery.refetch()}
              >
                <DataTable
                  ariaLabel="Integration connections"
                  columns={endpointColumns}
                  getRowId={(row) => row.id}
                  rows={endpointQuery.data ?? []}
                  search={{
                    label: 'Search connections',
                    placeholder: 'Connection name or address',
                    text: (row) => `${row.name} ${row.url} ${row.keyId}`,
                  }}
                />
              </QueryState>
            </>
          )}
        </SegmentedTabs>
      </Panel>

      <Dialog
        description="Enter the approved local address that should receive completed results."
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
              Create connection
            </Button>
          </>
        }
        onClose={cancelEndpointCreation}
        open={createOpen}
        title="Add a connection"
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
            label="Connection name"
            required
            {...register('name')}
          />
          <InputField
            error={errors.url?.message}
            helper="For the bundled demo, use http://127.0.0.1:3300/webhooks. Docker installations can use http://webhook-sink:3300/webhooks."
            id="endpoint-url"
            label="Receiving address"
            required
            type="url"
            {...register('url')}
          />
          <InputField
            error={errors.keyId?.message}
            helper="A short name for this connection's security key, such as local-v1."
            id="endpoint-key-id"
            label="Security key name"
            required
            {...register('keyId')}
          />
        </form>
      </Dialog>

      <Dialog
        description={
          createdEndpointNotice?.signingSecret === null
            ? 'This connection already exists, but its one-time secret was shown earlier and cannot be shown again.'
            : 'Copy this secret now. QueueForge will not reveal it again.'
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
            ? 'Connection secret is unavailable'
            : 'Connection signing secret'
        }
      >
        {createdEndpointNotice?.signingSecret === null ? (
          <div className="qf-inline-alert" role="alert">
            <ShieldCheck size={18} />
            <p>
              The connection <strong>{createdEndpointNotice.endpointName}</strong> was created, but
              its one-time secret was returned to an earlier response that did not reach this tab.
              {createdEndpointNotice.replayed ? ' This tab recovered the earlier action.' : ''}{' '}
              Create a replacement connection before using it; QueueForge will never reveal the
              committed secret again.
            </p>
          </div>
        ) : (
          <div className="qf-form-stack">
            <div className="qf-inline-alert" role="status">
              <ShieldCheck size={18} />
              <code className="qf-break-all">{createdEndpointNotice?.signingSecret}</code>
            </div>
            <p>
              Configure the receiving system with this secret before activating a request type that
              sends results to it. The bundled demo receiver is preconfigured only for the seeded
              connection; it does not automatically register newly generated secrets.
            </p>
          </div>
        )}
      </Dialog>

      <Dialog
        description="QueueForge will make a new delivery attempt and keep the earlier history."
        footer={
          <>
            <Button onClick={cancelReplay}>Cancel</Button>
            <Button
              disabled={!online}
              loading={replayMutation.isPending}
              loadingLabel="Queueing another try"
              onClick={() => {
                if (replayDelivery !== null) replayMutation.mutate(replayDelivery);
              }}
              tone="primary"
            >
              Try delivery again
            </Button>
          </>
        }
        onClose={cancelReplay}
        open={replayDelivery !== null}
        title="Try this delivery again?"
      >
        {replayMutation.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(replayMutation.error)}
          </div>
        ) : null}
        <p>The receiving system will see the same event reference so it can avoid duplicates.</p>
        <details className="qf-advanced-disclosure">
          <summary>Technical behavior</summary>
          <p>
            QueueForge creates a new delivery generation while preserving the original attempt
            history and stable event ID.
          </p>
        </details>
      </Dialog>
    </AppShell>
  );
}

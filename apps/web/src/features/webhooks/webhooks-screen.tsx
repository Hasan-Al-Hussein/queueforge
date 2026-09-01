'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Webhook,
  cn,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { CompactId, DateTime } from '../../components/format';
import { PaginationControls } from '../../components/pagination-controls';
import { PermissionGate } from '../../components/permission-gate';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
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
  deliveryPageCounts,
  initialDeliverySection,
  nextDeliveryAttemptAt,
  receiverReplyLabel,
  webhookDeliveryStatusLabel,
  webhookEventLabel,
} from './delivery-presentation';
import styles from './webhooks-screen.module.css';

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
const LEDGER_PAGE_SIZE = 10;
const MOBILE_LEDGER_PREVIEW_SIZE = 3;

interface CreatedEndpointNotice {
  readonly endpointName: string;
  readonly replayed: boolean;
  readonly signingSecret: string | null;
}

function DeliveryLedger({
  deliveries,
  expanded,
  online,
  onReplay,
}: {
  readonly deliveries: readonly WebhookDelivery[];
  readonly expanded: boolean;
  readonly online: boolean;
  readonly onReplay: (delivery: WebhookDelivery) => void;
}): React.JSX.Element {
  return (
    <div className={styles.deliveryLedger} id="result-delivery-ledger">
      <div
        aria-label="Result delivery history table"
        className={styles.desktopDeliveryTable}
        role="region"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Event</th>
              <th scope="col">Receiver</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Response</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((delivery) => {
              const nextAttemptAt = nextDeliveryAttemptAt(delivery);
              return (
                <tr
                  data-attention={delivery.status === 'dead' ? 'true' : 'false'}
                  key={delivery.id}
                >
                  <td>
                    <strong>{webhookEventLabel(delivery.eventType)}</strong>
                    <small>
                      {delivery.workflowName === null
                        ? 'System update'
                        : requestTypeLabel(delivery.workflowName)}
                    </small>
                  </td>
                  <td>{delivery.endpointName}</td>
                  <td>
                    <StatusBadge
                      status={delivery.status}
                      label={webhookDeliveryStatusLabel(delivery.status)}
                    />
                  </td>
                  <td>{deliveryAttemptLabel(delivery.attemptCount)}</td>
                  <td>{receiverReplyLabel(delivery.lastStatusCode)}</td>
                  <td>
                    <DateTime value={delivery.updatedAt} />
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <details className={cn('qf-advanced-disclosure', styles.rowDetails)}>
                        <summary>Details</summary>
                        <dl className="qf-key-values">
                          <dt>Event code</dt>
                          <dd>
                            <code>{delivery.eventType}</code>
                          </dd>
                          <dt>Event reference</dt>
                          <dd>
                            <CompactId value={delivery.eventId} />
                          </dd>
                          {delivery.requestId === null ? null : (
                            <>
                              <dt>Request reference</dt>
                              <dd>
                                <CompactId value={delivery.requestId} />
                              </dd>
                            </>
                          )}
                          {nextAttemptAt === null ? null : (
                            <>
                              <dt>Next attempt</dt>
                              <dd>
                                <DateTime value={nextAttemptAt} />
                              </dd>
                            </>
                          )}
                        </dl>
                      </details>
                      <PermissionGate permission="replay">
                        <Button
                          disabled={!online}
                          icon={<RotateCcw size={15} />}
                          onClick={() => onReplay(delivery)}
                          tone="quiet"
                        >
                          Replay
                        </Button>
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        aria-label="Result delivery history"
        className={styles.mobileDeliveryList}
        data-expanded={expanded ? 'true' : 'false'}
        role="list"
      >
        {deliveries.map((delivery, index) => {
          const nextAttemptAt = nextDeliveryAttemptAt(delivery);
          return (
            <article
              className={styles.deliveryItem}
              data-attention={delivery.status === 'dead' ? 'true' : 'false'}
              data-mobile-hidden={index >= MOBILE_LEDGER_PREVIEW_SIZE ? 'true' : 'false'}
              key={delivery.id}
              role="listitem"
            >
              <header>
                <div>
                  <p className={styles.kicker}>{webhookEventLabel(delivery.eventType)}</p>
                  <h3>{delivery.endpointName}</h3>
                </div>
                <StatusBadge
                  status={delivery.status}
                  label={webhookDeliveryStatusLabel(delivery.status)}
                />
              </header>
              <dl className={styles.deliveryEvidence}>
                <div>
                  <dt>Attempts</dt>
                  <dd>{deliveryAttemptLabel(delivery.attemptCount)}</dd>
                </div>
                <div>
                  <dt>Response</dt>
                  <dd>{receiverReplyLabel(delivery.lastStatusCode)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    <DateTime value={delivery.updatedAt} />
                  </dd>
                </div>
              </dl>
              {nextAttemptAt === null ? null : (
                <p className={styles.nextAttempt}>
                  Next attempt <DateTime value={nextAttemptAt} />
                </p>
              )}
              <div className={styles.mobileActions}>
                <details className={cn('qf-advanced-disclosure', styles.mobileDetails)}>
                  <summary>Details</summary>
                  <dl className="qf-key-values">
                    <dt>Event code</dt>
                    <dd>
                      <code>{delivery.eventType}</code>
                    </dd>
                    <dt>Event reference</dt>
                    <dd>
                      <CompactId value={delivery.eventId} />
                    </dd>
                  </dl>
                </details>
                <PermissionGate permission="replay">
                  <Button
                    disabled={!online}
                    icon={<RotateCcw size={15} />}
                    onClick={() => onReplay(delivery)}
                    tone="quiet"
                  >
                    Replay
                  </Button>
                </PermissionGate>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ConnectionLedger({
  endpoints,
}: {
  readonly endpoints: readonly WebhookEndpoint[];
}): React.JSX.Element {
  return (
    <div className={styles.connections}>
      <div
        aria-label="Integration connections table"
        className={styles.desktopConnectionTable}
        role="region"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Connection</th>
              <th scope="col">Receiving address</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col">Signing</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((endpoint) => (
              <tr key={endpoint.id}>
                <td>
                  <strong>{endpoint.name}</strong>
                </td>
                <td className={styles.endpointUrl}>{endpoint.url}</td>
                <td>
                  <StatusBadge
                    status={endpoint.active ? 'active' : 'retired'}
                    label={endpoint.active ? 'Ready' : 'Off'}
                  />
                </td>
                <td>
                  <DateTime value={endpoint.updatedAt} />
                </td>
                <td>
                  <details className={cn('qf-advanced-disclosure', styles.rowDetails)}>
                    <summary>Details</summary>
                    <p className="qf-utility">
                      Key reference: <code>{endpoint.keyId}</code>
                    </p>
                    <p className="qf-utility">
                      The signing secret cannot be retrieved after creation.
                    </p>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div aria-label="Integration connections" className={styles.mobileConnectionList} role="list">
        {endpoints.map((endpoint) => (
          <article className={styles.connectionCard} key={endpoint.id} role="listitem">
            <header>
              <div>
                <p className={styles.kicker}>Connection</p>
                <h3>{endpoint.name}</h3>
              </div>
              <StatusBadge
                status={endpoint.active ? 'active' : 'retired'}
                label={endpoint.active ? 'Ready' : 'Off'}
              />
            </header>
            <p className={styles.endpointUrl}>{endpoint.url}</p>
            <p className="qf-utility">
              Updated <DateTime value={endpoint.updatedAt} />
            </p>
            <details className="qf-advanced-disclosure">
              <summary>Signing details</summary>
              <p className="qf-utility">
                Key reference: <code>{endpoint.keyId}</code>
              </p>
              <p className="qf-utility">The signing secret cannot be retrieved after creation.</p>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}

export function WebhooksScreen(): React.JSX.Element {
  const deliveryPagination = usePagination(LEDGER_PAGE_SIZE);
  const { can, online } = useAuth();
  const [tab, setTab] = useState<'endpoints' | 'deliveries'>(() =>
    initialDeliverySection(can('configure_webhooks')),
  );
  const [deliveryPreviewExpanded, setDeliveryPreviewExpanded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [replayDelivery, setReplayDelivery] = useState<WebhookDelivery | null>(null);
  const [deliverySearch, setDeliverySearch] = useState('');
  const [connectionSearch, setConnectionSearch] = useState('');
  const [createdEndpointNotice, setCreatedEndpointNotice] = useState<CreatedEndpointNotice | null>(
    null,
  );
  const deferredDeliverySearch = useDeferredValue(deliverySearch.trim().toLowerCase());
  const deferredConnectionSearch = useDeferredValue(connectionSearch.trim().toLowerCase());
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
  const deliveries = useMemo(() => deliveryQuery.data?.items ?? [], [deliveryQuery.data?.items]);
  const endpoints = useMemo(() => endpointQuery.data ?? [], [endpointQuery.data]);
  const filteredDeliveries = useMemo(() => {
    if (deferredDeliverySearch === '') return deliveries;
    return deliveries.filter((delivery) =>
      `${delivery.endpointName} ${webhookEventLabel(delivery.eventType)} ${delivery.eventType} ${delivery.eventId} ${delivery.workflowName ?? ''} ${delivery.requestId ?? ''} ${webhookDeliveryStatusLabel(delivery.status)}`
        .toLowerCase()
        .includes(deferredDeliverySearch),
    );
  }, [deferredDeliverySearch, deliveries]);
  const filteredEndpoints = useMemo(() => {
    if (deferredConnectionSearch === '') return endpoints;
    return endpoints.filter((endpoint) =>
      `${endpoint.name} ${endpoint.url} ${endpoint.keyId}`
        .toLowerCase()
        .includes(deferredConnectionSearch),
    );
  }, [deferredConnectionSearch, endpoints]);
  const deliveryCounts = deliveryPageCounts(deliveries);

  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
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
          description="Configure receiving systems and inspect each signed delivery attempt, response, and replay."
          eyebrow="Integrations"
          icon={<Webhook size={18} />}
          meta="Stable event identity · signed payload · retained attempt history"
          title="Delivery"
          tone={deliveryCounts.attention > 0 ? 'warning' : 'signal'}
        />

        <ScrollReveal>
          <dl className={styles.summaryStrip} aria-label="Delivery summary">
            <div>
              <dt>Delivered</dt>
              <dd>{deliveryCounts.delivered}</dd>
            </div>
            <div>
              <dt>Moving or retrying</dt>
              <dd>{deliveryCounts.moving}</dd>
            </div>
            <div data-attention={deliveryCounts.attention > 0 ? 'true' : 'false'}>
              <dt>Needs attention</dt>
              <dd>{deliveryCounts.attention}</dd>
            </div>
            <div>
              <dt>Connections</dt>
              <dd>{endpoints.length}</dd>
            </div>
          </dl>
        </ScrollReveal>

        <ScrollReveal amount={0.08}>
          <Panel className={styles.deliveryPanel}>
            <SegmentedTabs
              ariaLabel="Integration sections"
              onValueChange={(value) => {
                setDeliveryPreviewExpanded(false);
                setTab(value);
              }}
              options={[
                { label: `Activity (${String(deliveries.length)})`, value: 'deliveries' },
                { label: `Connections (${String(endpoints.length)})`, value: 'endpoints' },
              ]}
              value={tab}
            >
              {tab === 'deliveries' ? (
                <>
                  <div className={styles.sectionIntro}>
                    <div>
                      <p className={styles.kicker}>Delivery activity</p>
                      <h2>Attempts and responses</h2>
                      <p>Each row shows the receiver, result, attempt count, and response.</p>
                    </div>
                    <InputField
                      id="delivery-history-search"
                      label="Search delivery history"
                      onChange={(event) => {
                        setDeliveryPreviewExpanded(false);
                        setDeliverySearch(event.currentTarget.value);
                      }}
                      placeholder="Destination, update, or status"
                      type="search"
                      value={deliverySearch}
                    />
                  </div>
                  <QueryState
                    empty={deliveryQuery.isSuccess && deliveries.length === 0}
                    emptyDescription="Completed requests will appear here after QueueForge sends their results to a connected system."
                    emptyTitle="Nothing has been sent yet"
                    error={deliveryQuery.error}
                    isLoading={deliveryQuery.isLoading}
                    onRetry={() => void deliveryQuery.refetch()}
                  >
                    {filteredDeliveries.length === 0 ? (
                      <div className={styles.localEmpty} role="status">
                        No delivery on this page matches that search.
                      </div>
                    ) : (
                      <DeliveryLedger
                        deliveries={filteredDeliveries}
                        expanded={deliveryPreviewExpanded}
                        online={online}
                        onReplay={setReplayDelivery}
                      />
                    )}
                    {filteredDeliveries.length > MOBILE_LEDGER_PREVIEW_SIZE ? (
                      <Button
                        aria-controls="result-delivery-ledger"
                        aria-expanded={deliveryPreviewExpanded}
                        className={styles.mobileLedgerToggle}
                        onClick={() => setDeliveryPreviewExpanded((expanded) => !expanded)}
                        tone="quiet"
                      >
                        {deliveryPreviewExpanded
                          ? 'Show fewer deliveries'
                          : `Show ${String(filteredDeliveries.length - MOBILE_LEDGER_PREVIEW_SIZE)} more on this page`}
                      </Button>
                    ) : null}
                    <p className="qf-utility" aria-live="polite">
                      Loaded {String(filteredDeliveries.length)} of {String(deliveries.length)}{' '}
                      results on this page.
                    </p>
                  </QueryState>
                  {deliveryQuery.data?.meta === undefined ? null : (
                    <PaginationControls
                      ariaLabel="Result deliveries"
                      disabled={deliveryQuery.isFetching}
                      meta={deliveryQuery.data.meta}
                      onPageChange={(page) => {
                        setDeliveryPreviewExpanded(false);
                        deliveryPagination.setPage(page);
                      }}
                      onPageSizeChange={(pageSize) => {
                        setDeliveryPreviewExpanded(false);
                        deliveryPagination.setPageSize(pageSize);
                      }}
                      page={deliveryPagination.page}
                      pageSize={deliveryPagination.pageSize}
                    />
                  )}
                </>
              ) : (
                <>
                  <div className={styles.sectionIntro}>
                    <div>
                      <p className={styles.kicker}>Receiving systems</p>
                      <h2>Connections</h2>
                      <p>Only configured addresses can receive completed results.</p>
                    </div>
                    <InputField
                      id="integration-connections-search"
                      label="Search connections"
                      onChange={(event) => setConnectionSearch(event.currentTarget.value)}
                      placeholder="Connection name or address"
                      type="search"
                      value={connectionSearch}
                    />
                  </div>
                  <QueryState
                    empty={endpointQuery.isSuccess && endpoints.length === 0}
                    emptyDescription="Add the local system that should receive completed results."
                    emptyTitle="No connections yet"
                    error={endpointQuery.error}
                    isLoading={endpointQuery.isLoading}
                    onRetry={() => void endpointQuery.refetch()}
                  >
                    {filteredEndpoints.length === 0 ? (
                      <div className={styles.localEmpty} role="status">
                        No connection matches that search.
                      </div>
                    ) : (
                      <ConnectionLedger endpoints={filteredEndpoints} />
                    )}
                    <div className={styles.signingNote} role="note">
                      <ShieldCheck size={16} />
                      <p>
                        A new connection receives its signing secret once. Replays keep the original
                        event identity and attempt history.
                      </p>
                    </div>
                  </QueryState>
                </>
              )}
            </SegmentedTabs>
          </Panel>
        </ScrollReveal>
      </div>

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
            <div className={styles.secretReveal} role="status">
              <ShieldCheck size={18} />
              <div>
                <strong>Visible once</strong>
                <code className="qf-break-all">{createdEndpointNotice?.signingSecret}</code>
              </div>
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

'use client';

import { useDeferredValue, useId, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Button,
  Dialog,
  FileLock2,
  InputField,
  Panel,
  RefreshCw,
  SelectField,
} from '@queueforge/ui';

import { apiRequest } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { CompactId, DateTime } from '../../components/format';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
import { PagedAuditSchema, type AuditEvent } from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { activityPresentation, formattedTechnicalSummary } from './activity-presentation';
import styles from './audit-screen.module.css';

const ACTIVITY_FILTERS = [
  { label: 'All activity', value: '' },
  { label: 'Requests', value: 'request.' },
  { label: 'Approvals', value: 'approval.' },
  { label: 'Recovery actions', value: 'dead_letter.' },
  { label: 'Integrations', value: 'webhook.' },
  { label: 'Notifications', value: 'notification.' },
  { label: 'Request types', value: 'workflow.' },
  { label: 'Team access', value: 'membership.' },
  { label: 'Workspace changes', value: 'tenant.' },
  { label: 'Sign-ins and security', value: 'auth.' },
  { label: 'API access', value: 'api_client.' },
] as const;
const LEDGER_PAGE_SIZE = 10;
const MOBILE_LEDGER_PREVIEW_SIZE = 5;

export function ActivityList({
  events,
  expanded,
  onSelectEvent,
}: {
  readonly events: readonly AuditEvent[];
  readonly expanded: boolean;
  readonly onSelectEvent: (event: AuditEvent) => void;
}): React.JSX.Element {
  return (
    <div
      aria-label="Workspace activity log"
      className={styles.activityList}
      data-expanded={expanded ? 'true' : 'false'}
      id="workspace-activity-ledger"
      role="list"
    >
      <div className={styles.listHeader} aria-hidden="true">
        <span>Action</span>
        <span>Target</span>
        <span>Actor</span>
        <span>Time</span>
        <span />
      </div>
      {events.map((event) => {
        const presentation = activityPresentation(event);
        const actor = event.actorName === null ? 'QueueForge automatically' : event.actorName;
        return (
          <article className={styles.activityItem} key={event.id} role="listitem">
            <div className={styles.actionCell}>
              <span className={styles.kicker}>{presentation.category}</span>
              <strong>{presentation.action}</strong>
            </div>
            <span className={styles.targetCell}>{presentation.resource}</span>
            <span className={styles.actorCell}>{actor}</span>
            <span className={styles.timeCell}>
              <DateTime value={event.occurredAt} />
            </span>
            <Button
              aria-label={`View details for ${presentation.action}`}
              className={styles.detailAction}
              icon={<ArrowRight size={16} />}
              onClick={() => onSelectEvent(event)}
              tone="quiet"
            />
          </article>
        );
      })}
    </div>
  );
}

export function AuditEventDetail({ event }: { readonly event: AuditEvent }): React.JSX.Element {
  const presentation = activityPresentation(event);
  const detailId = useId();

  return (
    <div className={styles.eventDetail}>
      <section aria-labelledby={`${detailId}-context`} className={styles.detailSection}>
        <header className={styles.detailSectionHeader}>
          <h3 id={`${detailId}-context`}>Record details</h3>
          <p>Time, actor, target, and retained references.</p>
        </header>
        <dl className={styles.detailFacts}>
          <div className={styles.detailFact}>
            <dt>Occurred</dt>
            <dd className={styles.detailDate}>
              <DateTime value={event.occurredAt} />
            </dd>
          </div>
          <div className={styles.detailFact}>
            <dt>Actor</dt>
            <dd>{event.actorName ?? 'QueueForge automatically'}</dd>
          </div>
          <div className={styles.detailFact}>
            <dt>Target</dt>
            <dd>{presentation.resource}</dd>
          </div>
          <div className={styles.detailFact}>
            <dt>Event code</dt>
            <dd>
              <code>{event.eventType}</code>
            </dd>
          </div>
          <div className={styles.detailFact}>
            <dt>Resource type</dt>
            <dd>
              <code>{event.resourceType}</code>
            </dd>
          </div>
          {event.resourceId === null ? null : (
            <div className={styles.detailFact}>
              <dt>Resource reference</dt>
              <dd>
                <CompactId value={event.resourceId} />
              </dd>
            </div>
          )}
          <div
            className={
              event.resourceId === null
                ? styles.detailFact
                : `${styles.detailFact} ${styles.detailFactWide}`
            }
          >
            <dt>Trace reference</dt>
            <dd>
              <CompactId value={event.correlationId} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby={`${detailId}-technical`} className={styles.detailSection}>
        <header className={styles.detailSectionHeader}>
          <h3 id={`${detailId}-technical`}>Technical record</h3>
          <p>Structured event data preserved with this activity record.</p>
        </header>
        <textarea
          aria-labelledby={`${detailId}-technical`}
          className={`qf-code-block qf-code-block--compact ${styles.technicalRecord}`}
          readOnly
          rows={4}
          spellCheck={false}
          value={formattedTechnicalSummary(event.summary)}
        />
      </section>
    </div>
  );
}

export function AuditScreen(): React.JSX.Element {
  const pagination = usePagination(LEDGER_PAGE_SIZE);
  const [eventType, setEventType] = useState('');
  const [pageSearch, setPageSearch] = useState('');
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const deferredEventType = useDeferredValue(eventType.trim());
  const deferredPageSearch = useDeferredValue(pageSearch.trim().toLowerCase());
  const auditQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['audit', deferredEventType, pagination.page, pagination.pageSize],
    queryFn: ({ signal }) => {
      const query = pageSearchParams(pagination);
      if (deferredEventType !== '') query.set('eventType', deferredEventType);
      return apiRequest(`${routes.audit}?${query.toString()}`, {
        schema: PagedAuditSchema,
        signal,
      });
    },
  });
  const rows = useMemo(() => auditQuery.data?.items ?? [], [auditQuery.data?.items]);
  const filteredRows = useMemo(() => {
    if (deferredPageSearch === '') return rows;
    return rows.filter((row) => {
      const presentation = activityPresentation(row);
      return `${presentation.action} ${presentation.summary} ${presentation.category} ${row.eventType} ${row.actorName ?? 'QueueForge'} ${row.summary} ${row.correlationId}`
        .toLowerCase()
        .includes(deferredPageSearch);
    });
  }, [deferredPageSearch, rows]);
  const selectedFilter =
    ACTIVITY_FILTERS.find((option) => option.value === eventType)?.label ?? 'Filtered activity';
  const selectedPresentation = selectedEvent === null ? null : activityPresentation(selectedEvent);

  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
          actions={
            <Button
              icon={<RefreshCw size={16} />}
              loading={auditQuery.isFetching}
              onClick={() => void auditQuery.refetch()}
            >
              Refresh
            </Button>
          }
          description="Review who changed what, when it happened, and the retained technical record."
          eyebrow="Workspace history"
          icon={<FileLock2 size={18} />}
          title="Activity log"
        />

        <ScrollReveal amount={0.08}>
          <Panel
            className={styles.activityPanel}
            title="Recorded activity"
            description={`${selectedFilter} · newest first on this page`}
            actions={
              <div
                aria-label="Activity log retention and result count"
                className={styles.ledgerMeta}
                role="group"
              >
                <span>{String(filteredRows.length)} visible</span>
                <span>
                  <FileLock2 size={14} />
                  History retained
                </span>
              </div>
            }
          >
            <div className={styles.toolbar}>
              <SelectField
                id="audit-event-filter"
                label="Show activity for"
                onChange={(event) => {
                  pagination.resetPage();
                  setMobilePreviewExpanded(false);
                  setSelectedEvent(null);
                  setEventType(event.currentTarget.value);
                }}
                value={eventType}
              >
                {ACTIVITY_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              <InputField
                id="activity-page-search"
                label="Search activity on this page"
                onChange={(event) => {
                  setMobilePreviewExpanded(false);
                  setSelectedEvent(null);
                  setPageSearch(event.currentTarget.value);
                }}
                placeholder="Action, person, or technical reference"
                type="search"
                value={pageSearch}
              />
            </div>
            <QueryState
              empty={auditQuery.isSuccess && rows.length === 0}
              emptyDescription="No recorded activity matches this category in the current workspace."
              emptyTitle="No matching activity"
              error={auditQuery.error}
              isLoading={auditQuery.isLoading}
              onRetry={() => void auditQuery.refetch()}
            >
              {filteredRows.length === 0 ? (
                <div className={styles.localEmpty} role="status">
                  No activity on this page matches that search.
                </div>
              ) : (
                <ActivityList
                  events={filteredRows}
                  expanded={mobilePreviewExpanded}
                  onSelectEvent={setSelectedEvent}
                />
              )}
              {filteredRows.length > MOBILE_LEDGER_PREVIEW_SIZE ? (
                <Button
                  aria-controls="workspace-activity-ledger"
                  aria-expanded={mobilePreviewExpanded}
                  className={styles.mobileLedgerToggle}
                  onClick={() => setMobilePreviewExpanded((expanded) => !expanded)}
                  tone="quiet"
                >
                  {mobilePreviewExpanded
                    ? 'Show fewer activity records'
                    : `Show ${String(filteredRows.length - MOBILE_LEDGER_PREVIEW_SIZE)} more on this page`}
                </Button>
              ) : null}
              <p className="qf-utility" aria-live="polite">
                Loaded {String(filteredRows.length)} of {String(rows.length)} records on this page.
              </p>
            </QueryState>
            {auditQuery.data?.meta === undefined ? null : (
              <PaginationControls
                ariaLabel="Activity log"
                disabled={auditQuery.isFetching}
                meta={auditQuery.data.meta}
                onPageChange={(page) => {
                  setMobilePreviewExpanded(false);
                  setSelectedEvent(null);
                  pagination.setPage(page);
                }}
                onPageSizeChange={(pageSize) => {
                  setMobilePreviewExpanded(false);
                  setSelectedEvent(null);
                  pagination.setPageSize(pageSize);
                }}
                page={pagination.page}
                pageSize={pagination.pageSize}
              />
            )}
          </Panel>
        </ScrollReveal>
      </div>

      <Dialog
        description={selectedPresentation?.summary}
        onClose={() => setSelectedEvent(null)}
        open={selectedEvent !== null}
        title={selectedPresentation?.action ?? 'Activity details'}
      >
        {selectedEvent === null || selectedPresentation === null ? null : (
          <AuditEventDetail event={selectedEvent} />
        )}
      </Dialog>
    </AppShell>
  );
}

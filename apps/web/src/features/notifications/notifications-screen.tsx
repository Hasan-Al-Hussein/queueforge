'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Button,
  Check,
  Panel,
  RefreshCw,
  SegmentedTabs,
  StatusBadge,
  cn,
} from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { ScrollReveal } from '../../components/cinematic-motion';
import { CompactId, DateTime } from '../../components/format';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import { RouteHero } from '../../components/route-hero';
import {
  NotificationSchema,
  PagedNotificationsSchema,
  type Notification,
} from '../../domain/models';
import { requestTypeLabel } from '../../domain/presentation';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { notificationPageCounts, notificationPresentation } from './notification-presentation';
import styles from './notifications-screen.module.css';

const LEDGER_PAGE_SIZE = 10;
const MOBILE_LEDGER_PREVIEW_SIZE = 5;

export function NotificationsScreen(): React.JSX.Element {
  const pagination = usePagination(LEDGER_PAGE_SIZE);
  const [filter, setFilter] = useState<'action' | 'all' | 'unread'>('all');
  const [mobilePreviewExpanded, setMobilePreviewExpanded] = useState(false);
  const { online } = useAuth();
  const { notify } = useToast();
  const queryClient = useQueryClient();
  const notificationsQuery = useQuery({
    placeholderData: keepPreviousData,
    queryKey: ['notifications', pagination.page, pagination.pageSize],
    queryFn: ({ signal }) =>
      apiRequest(`${routes.notifications}?${pageSearchParams(pagination).toString()}`, {
        schema: PagedNotificationsSchema,
        signal,
      }),
  });
  const markRead = useMutation({
    mutationFn: (notification: Notification) =>
      apiRequest(routes.notification(notification.id), {
        body: { read: true },
        method: 'PATCH',
        schema: NotificationSchema,
      }),
    onSuccess: async () => {
      notify('Update marked as read.', 'success');
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const rows = useMemo(
    () => notificationsQuery.data?.items ?? [],
    [notificationsQuery.data?.items],
  );
  const visibleRows = useMemo(() => {
    if (filter === 'unread') return rows.filter((item) => item.readAt === null);
    if (filter === 'action') {
      return rows.filter((item) =>
        ['Action needed', 'Problem'].includes(notificationPresentation(item).label),
      );
    }
    return rows;
  }, [filter, rows]);
  const pageCounts = notificationPageCounts(rows);
  const unreadCount = pageCounts.unread;
  const actionCount = pageCounts.action;
  const problemCount = pageCounts.problems;
  return (
    <AppShell>
      <div className={styles.screen}>
        <RouteHero
          actions={
            <Button
              icon={<RefreshCw size={16} />}
              loading={notificationsQuery.isFetching}
              onClick={() => void notificationsQuery.refetch()}
            >
              Refresh
            </Button>
          }
          description="See decisions, completed work, retries, and problems connected to the request that caused them."
          eyebrow="Personal updates"
          icon={<Bell size={18} />}
          meta="Read state is personal to this account"
          title="Notifications"
          tone={actionCount + problemCount > 0 ? 'warning' : 'signal'}
        />

        <ScrollReveal>
          <dl className={styles.summaryStrip} aria-label="Notification summary">
            <div>
              <dt>Unread</dt>
              <dd>{unreadCount}</dd>
            </div>
            <div data-attention={actionCount > 0 ? 'true' : 'false'}>
              <dt>Action needed</dt>
              <dd>{actionCount}</dd>
            </div>
            <div data-attention={problemCount > 0 ? 'true' : 'false'}>
              <dt>Problems</dt>
              <dd>{problemCount}</dd>
            </div>
            <div>
              <dt>Loaded</dt>
              <dd>{rows.length}</dd>
            </div>
          </dl>
        </ScrollReveal>

        {markRead.error !== null ? (
          <div className="qf-form-error" role="alert">
            {formatProblem(markRead.error)}
          </div>
        ) : null}

        <ScrollReveal amount={0.08}>
          <Panel
            className={styles.inboxPanel}
            title="Your updates"
            description="Open the related request when an update needs a decision or follow-up."
          >
            <SegmentedTabs
              ariaLabel="Update filter"
              onValueChange={(value) => {
                setFilter(value);
                setMobilePreviewExpanded(false);
              }}
              options={[
                { label: `All (${String(rows.length)})`, value: 'all' },
                { label: `Unread (${String(unreadCount)})`, value: 'unread' },
                {
                  label: `Action needed (${String(actionCount + problemCount)})`,
                  value: 'action',
                },
              ]}
              value={filter}
            >
              <QueryState
                empty={notificationsQuery.isSuccess && visibleRows.length === 0}
                emptyDescription={
                  filter === 'unread'
                    ? 'Every update on this page has been read. Check another page or return to all updates.'
                    : filter === 'action'
                      ? 'No update on this page needs your attention.'
                      : 'QueueForge has no update to show you yet.'
                }
                emptyTitle={
                  filter === 'unread'
                    ? 'You are caught up'
                    : filter === 'action'
                      ? 'Nothing needs action'
                      : 'No updates yet'
                }
                error={notificationsQuery.error}
                isLoading={notificationsQuery.isLoading}
                onRetry={() => void notificationsQuery.refetch()}
              >
                <div
                  aria-label="Updates"
                  className={styles.notificationLedger}
                  data-expanded={mobilePreviewExpanded ? 'true' : 'false'}
                  id="updates-ledger"
                  role="list"
                >
                  {visibleRows.map((notification, sequence) => {
                    const presentation = notificationPresentation(notification);
                    const needsAttention = ['Action needed', 'Problem'].includes(
                      presentation.label,
                    );
                    const bodyRepeatsHeading =
                      notification.body.trim().toLocaleLowerCase() ===
                      presentation.heading.trim().toLocaleLowerCase();
                    return (
                      <article
                        className={cn(
                          styles.notification,
                          notification.readAt !== null && styles.read,
                        )}
                        data-attention={needsAttention ? 'true' : 'false'}
                        data-mobile-hidden={
                          sequence >= MOBILE_LEDGER_PREVIEW_SIZE ? 'true' : 'false'
                        }
                        key={notification.id}
                        role="listitem"
                      >
                        <span className={styles.unreadMarker} aria-hidden="true" />
                        <div className={styles.notificationBody}>
                          <header>
                            <div>
                              <p className={styles.kicker}>
                                {notification.readAt === null ? 'Unread' : 'Read'} ·{' '}
                                <DateTime value={notification.createdAt} />
                              </p>
                              <h3>{presentation.heading}</h3>
                            </div>
                            <StatusBadge status={presentation.status} label={presentation.label} />
                          </header>
                          {bodyRepeatsHeading ? null : (
                            <p className={styles.bodyCopy}>{notification.body}</p>
                          )}
                          <div className={styles.notificationMeta}>
                            <span>
                              {notification.requestId === null && notification.workflowName === null
                                ? 'Workspace update'
                                : notification.workflowName === null
                                  ? 'Related request'
                                  : requestTypeLabel(notification.workflowName)}
                            </span>
                            {notification.requestId === null ? null : (
                              <Link
                                className={styles.relatedLink}
                                href={`/requests/detail?id=${encodeURIComponent(notification.requestId)}`}
                                prefetch={false}
                              >
                                Open request
                              </Link>
                            )}
                            <details className={cn('qf-advanced-disclosure', styles.details)}>
                              <summary>Details</summary>
                              <dl className="qf-key-values">
                                <dt>Original update</dt>
                                <dd>{notification.title}</dd>
                                <dt>Notification reference</dt>
                                <dd>
                                  <CompactId value={notification.id} />
                                </dd>
                                {notification.requestId === null ? null : (
                                  <>
                                    <dt>Request reference</dt>
                                    <dd>
                                      <CompactId value={notification.requestId} />
                                    </dd>
                                  </>
                                )}
                              </dl>
                            </details>
                          </div>
                        </div>
                        {notification.readAt === null ? (
                          <Button
                            aria-label={`Mark ${presentation.heading} as read`}
                            disabled={!online}
                            icon={<Check size={15} />}
                            loading={
                              markRead.isPending && markRead.variables.id === notification.id
                            }
                            onClick={() => markRead.mutate(notification)}
                            tone="quiet"
                          >
                            Mark read
                          </Button>
                        ) : (
                          <span className={styles.readState}>
                            <Check size={14} aria-hidden="true" /> Read
                          </span>
                        )}
                      </article>
                    );
                  })}
                </div>
                {visibleRows.length > MOBILE_LEDGER_PREVIEW_SIZE ? (
                  <Button
                    aria-controls="updates-ledger"
                    aria-expanded={mobilePreviewExpanded}
                    className={styles.mobileLedgerToggle}
                    onClick={() => setMobilePreviewExpanded((expanded) => !expanded)}
                    tone="quiet"
                  >
                    {mobilePreviewExpanded
                      ? 'Show fewer updates'
                      : `Show ${String(visibleRows.length - MOBILE_LEDGER_PREVIEW_SIZE)} more on this page`}
                  </Button>
                ) : null}
              </QueryState>
              {notificationsQuery.data?.meta === undefined ? null : (
                <PaginationControls
                  ariaLabel="Updates"
                  disabled={notificationsQuery.isFetching}
                  meta={notificationsQuery.data.meta}
                  onPageChange={(page) => {
                    setMobilePreviewExpanded(false);
                    pagination.setPage(page);
                  }}
                  onPageSizeChange={(pageSize) => {
                    setMobilePreviewExpanded(false);
                    pagination.setPageSize(pageSize);
                  }}
                  page={pagination.page}
                  pageSize={pagination.pageSize}
                />
              )}
            </SegmentedTabs>
          </Panel>
        </ScrollReveal>
      </div>
    </AppShell>
  );
}

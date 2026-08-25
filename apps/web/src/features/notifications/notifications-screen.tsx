'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Check, Panel, RefreshCw, StatusBadge, cn } from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { CompactId, DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import {
  NotificationSchema,
  PagedNotificationsSchema,
  type Notification,
} from '../../domain/models';
import { requestTypeLabel } from '../../domain/presentation';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';
import { notificationPresentation } from './notification-presentation';

export function NotificationsScreen(): React.JSX.Element {
  const pagination = usePagination();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
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
  const visibleRows = useMemo(
    () => (filter === 'unread' ? rows.filter((item) => item.readAt === null) : rows),
    [filter, rows],
  );
  const unreadCount = rows.filter((item) => item.readAt === null).length;

  return (
    <AppShell>
      <PageHeader
        actions={
          <Button
            icon={<RefreshCw size={16} />}
            loading={notificationsQuery.isFetching}
            onClick={() => void notificationsQuery.refetch()}
          >
            Refresh
          </Button>
        }
        description="Clear updates about decisions, completed requests, retries, and problems."
        eyebrow="Stay informed"
        title="Updates"
      />
      {markRead.error !== null ? (
        <div className="qf-form-error" role="alert">
          {formatProblem(markRead.error)}
        </div>
      ) : null}
      <Panel
        title="Your updates"
        description={`${String(unreadCount)} unread update${unreadCount === 1 ? '' : 's'} on this page`}
      >
        <div className="qf-segmented" role="tablist" aria-label="Update filter">
          <button
            aria-selected={filter === 'all'}
            onClick={() => setFilter('all')}
            role="tab"
            type="button"
          >
            All
          </button>
          <button
            aria-selected={filter === 'unread'}
            onClick={() => setFilter('unread')}
            role="tab"
            type="button"
          >
            Unread ({String(unreadCount)})
          </button>
        </div>
        <QueryState
          empty={notificationsQuery.isSuccess && visibleRows.length === 0}
          emptyDescription={
            filter === 'unread'
              ? 'Every update on this page has been read. Check another page or return to all updates.'
              : 'QueueForge has no update to show you yet.'
          }
          emptyTitle={filter === 'unread' ? 'You are caught up' : 'No updates yet'}
          error={notificationsQuery.error}
          isLoading={notificationsQuery.isLoading}
          onRetry={() => void notificationsQuery.refetch()}
        >
          <div className="qf-notification-list" role="list">
            {visibleRows.map((notification) => {
              const presentation = notificationPresentation(notification);
              return (
                <article
                  className={cn(
                    'qf-notification',
                    notification.readAt !== null && 'qf-notification--read',
                  )}
                  key={notification.id}
                  role="listitem"
                >
                  <span className="qf-notification__marker" aria-hidden="true" />
                  <div>
                    <div className="qf-notification__title">
                      <h2>{presentation.heading}</h2>
                      <StatusBadge status={presentation.status} label={presentation.label} />
                    </div>
                    <p>{notification.body}</p>
                    {notification.requestId === null && notification.workflowName === null ? (
                      <p className="qf-utility">Workspace update · no request linked</p>
                    ) : (
                      <div className="qf-utility">
                        <strong>
                          Request type:{' '}
                          {notification.workflowName === null
                            ? 'Request'
                            : requestTypeLabel(notification.workflowName)}
                        </strong>
                        {notification.requestId === null ? null : (
                          <div>
                            Reference: <CompactId value={notification.requestId} />
                          </div>
                        )}
                      </div>
                    )}
                    <DateTime value={notification.createdAt} />
                    <details className="qf-advanced-disclosure">
                      <summary>Update details</summary>
                      <dl className="qf-key-values">
                        <dt>Original update</dt>
                        <dd>{notification.title}</dd>
                        <dt>Reference</dt>
                        <dd>
                          <CompactId value={notification.id} />
                        </dd>
                      </dl>
                    </details>
                  </div>
                  {notification.readAt === null ? (
                    <Button
                      aria-label={`Mark ${presentation.heading} as read`}
                      disabled={!online}
                      icon={<Check size={15} />}
                      loading={markRead.isPending && markRead.variables.id === notification.id}
                      onClick={() => markRead.mutate(notification)}
                      tone="quiet"
                    >
                      Mark read
                    </Button>
                  ) : (
                    <span className="qf-utility">Read</span>
                  )}
                </article>
              );
            })}
          </div>
        </QueryState>
        {notificationsQuery.data?.meta === undefined ? null : (
          <PaginationControls
            ariaLabel="Updates"
            disabled={notificationsQuery.isFetching}
            meta={notificationsQuery.data.meta}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
            page={pagination.page}
            pageSize={pagination.pageSize}
          />
        )}
      </Panel>
    </AppShell>
  );
}

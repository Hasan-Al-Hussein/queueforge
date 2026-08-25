'use client';

import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Check, Panel, RefreshCw, StatusBadge, cn } from '@queueforge/ui';

import { apiRequest, formatProblem } from '../../api/client';
import { routes } from '../../api/routes';
import { AppShell } from '../../components/app-shell';
import { DateTime } from '../../components/format';
import { PageHeader } from '../../components/page-header';
import { PaginationControls } from '../../components/pagination-controls';
import { QueryState } from '../../components/query-state';
import {
  NotificationSchema,
  PagedNotificationsSchema,
  type Notification,
} from '../../domain/models';
import { pageSearchParams, usePagination } from '../../hooks/use-pagination';
import { useAuth } from '../../providers/auth-provider';
import { useToast } from '../../providers/toast-provider';

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
      notify('Notification marked as read.', 'success');
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
        description="Important updates about approvals, retries, failures, and completed work."
        eyebrow="Stay informed"
        title="Notifications"
      />
      {markRead.error !== null ? (
        <div className="qf-form-error" role="alert">
          {formatProblem(markRead.error)}
        </div>
      ) : null}
      <Panel
        title="Inbox"
        description={`${String(unreadCount)} unread notification${unreadCount === 1 ? '' : 's'} on this page`}
      >
        <div className="qf-segmented" role="tablist" aria-label="Notification filter">
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
              ? 'Every notification on this page has been read. Check another page or return to all notifications.'
              : 'No operational event has produced an in-app notification.'
          }
          emptyTitle={filter === 'unread' ? 'You are caught up' : 'Inbox is empty'}
          error={notificationsQuery.error}
          isLoading={notificationsQuery.isLoading}
          onRetry={() => void notificationsQuery.refetch()}
        >
          <div className="qf-notification-list" role="list">
            {visibleRows.map((notification) => (
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
                    <h2>{notification.title}</h2>
                    <StatusBadge
                      status={notification.kind === 'error' ? 'failed' : notification.kind}
                      label={notification.kind}
                    />
                  </div>
                  <p>{notification.body}</p>
                  <DateTime value={notification.createdAt} />
                </div>
                {notification.readAt === null ? (
                  <Button
                    aria-label={`Mark ${notification.title} as read`}
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
            ))}
          </div>
        </QueryState>
        {notificationsQuery.data?.meta === undefined ? null : (
          <PaginationControls
            ariaLabel="Notifications"
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

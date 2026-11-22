'use client';

import { useMemo, useState } from 'react';
import { type Notification, type NotificationFilters, type TeamDetail } from '@/lib/api';
import { qk } from '@/services/queryKeys';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import { useInboxUnread } from '@/hooks/useInboxUnread';
import IssueDetailContent from '@/features/issue/components/detail/IssueDetailContent';
import InboxToolbar from './InboxToolbar';
import InboxList from './InboxList';
import {
  useNotificationsQuery,
  useSetNotificationRead,
  useSnoozeNotification,
  useDeleteNotification,
  useMarkAllRead,
  useDeleteNotifications,
} from '../services/notifications.service';

export default function InboxView({ team }: { team: TeamDetail }) {
  const teamKey = team.team.key;
  const teamId = team.team.id;

  const [filters, setFilters] = useState<NotificationFilters>({});
  const [selected, setSelected] = useState<Notification | null>(null);

  const query = useNotificationsQuery(teamKey, teamId, filters);
  const unreadQuery = useInboxUnread(teamKey, teamId);
  const setRead = useSetNotificationRead(teamKey);
  const snooze = useSnoozeNotification(teamKey);
  const deleteOne = useDeleteNotification(teamKey);
  const markAllRead = useMarkAllRead(teamKey, teamId);
  const deleteNotifications = useDeleteNotifications(teamKey, teamId);

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);

  useLiveRefresh({
    targets: [['notifications', teamKey], qk.notificationsUnread(teamKey)],
  });

  const onSelect = (n: Notification) => {
    setSelected(n);
    if (n.readAt == null) setRead.mutate({ id: n.id, read: true });
  };

  const onDelete = (n: Notification) => {
    if (selected?.id === n.id) setSelected(null);
    deleteOne.mutate(n.id);
  };

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-full max-w-sm min-w-0 flex-col border-r">
        <InboxToolbar
          unread={unreadQuery.data ?? 0}
          filters={filters}
          onFiltersChange={setFilters}
          onMarkAllRead={() => markAllRead.mutate()}
          onDeleteRead={() => deleteNotifications.mutate('read')}
          onDeleteReadCompleted={() => deleteNotifications.mutate('read-completed')}
        />
        <InboxList
          items={items}
          isLoading={query.isLoading}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onToggleRead={(n, read) => setRead.mutate({ id: n.id, read })}
          onSnooze={(n, until) => snooze.mutate({ id: n.id, until })}
          onDelete={onDelete}
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onLoadMore={() => query.fetchNextPage()}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="px-6 py-6 xl:px-10">
            <IssueDetailContent
              key={selected.issueId}
              team={team}
              issueId={selected.issueId}
              layout="split"
              onDeleted={() => setSelected(null)}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a notification
          </div>
        )}
      </div>
    </div>
  );
}

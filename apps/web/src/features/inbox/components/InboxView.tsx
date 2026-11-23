'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type Notification } from '@/lib/api';
import { useNotificationsList } from '@/services/notifications.service';
import { unreadCount } from '@/utils/notifications';
import IssueDetailContent from '@/features/issue/components/detail/IssueDetailContent';
import InboxToolbar from './InboxToolbar';
import InboxSelectionBar from './InboxSelectionBar';
import InboxList from './InboxList';
import { useInboxTeam } from '../hooks/useInboxTeam';
import {
  DEFAULT_INBOX_FILTERS,
  issuesWithUnread,
  readForCompletedIssues,
  visibleNotifications,
  type InboxFilters,
} from '../utils/inbox';
import {
  useChangeNotifications,
  useMarkIssuesRead,
  type InboxChange,
} from '../services/notifications.service';

// The workspace inbox: the viewer's notifications from every team on the left, the
// open notification's issue on the right.
export default function InboxView() {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [selected, setSelected] = useState<Notification | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const query = useNotificationsList();
  const change = useChangeNotifications();
  const markIssuesRead = useMarkIssuesRead();
  const team = useInboxTeam(selected?.teamKey ?? null);

  const list = useMemo(() => query.data ?? [], [query.data]);
  const now = new Date();
  const items = visibleNotifications(list, filters, now);
  const unread = unreadCount(list, now);

  const run = (ids: string[], next: InboxChange) => {
    if (ids.length > 0) change.mutate({ ids, change: next });
  };

  const archive = (ids: string[]) => {
    if (ids.length === 0) return;
    if (selected && ids.includes(selected.id)) setSelected(null);
    run(ids, { kind: 'archive' });
    const what = ids.length === 1 ? 'Notification' : `${ids.length} notifications`;
    toast.success(`${what} archived.`, {
      action: { label: 'Undo', onClick: () => run(ids, { kind: 'unarchive' }) },
    });
  };

  const onSelect = (n: Notification) => {
    setSelected(n);
    if (n.readAt == null) run([n.id], { kind: 'read', read: true });
  };

  const onChecked = (n: Notification, isChecked: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (isChecked) next.add(n.id);
      else next.delete(n.id);
      return next;
    });

  const checkedIds = [...checked];
  const clearChecked = () => setChecked(new Set());

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-full max-w-sm min-w-0 flex-col border-r">
        {checked.size > 0 ? (
          <InboxSelectionBar
            count={checked.size}
            onRead={(read) => {
              run(checkedIds, { kind: 'read', read });
              clearChecked();
            }}
            onSnooze={(until) => {
              run(checkedIds, { kind: 'snooze', until });
              clearChecked();
            }}
            onArchive={() => {
              archive(checkedIds);
              clearChecked();
            }}
            onClear={clearChecked}
          />
        ) : (
          <InboxToolbar
            unread={unread}
            filters={filters}
            onFiltersChange={setFilters}
            onMarkAllRead={() => markIssuesRead.mutate(issuesWithUnread(list))}
            onArchiveRead={() =>
              archive(list.filter((n) => n.archivedAt == null && n.readAt != null).map((n) => n.id))
            }
            onArchiveReadCompleted={() => archive(readForCompletedIssues(list).map((n) => n.id))}
          />
        )}
        <InboxList
          items={items}
          isLoading={query.isLoading}
          selectedId={selected?.id ?? null}
          checkedIds={checked}
          onSelect={onSelect}
          onCheckedChange={onChecked}
          onToggleRead={(n, read) => run([n.id], { kind: 'read', read })}
          onSnooze={(n, until) => run([n.id], { kind: 'snooze', until })}
          onArchive={(n) => archive([n.id])}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected && team ? (
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
            {selected ? 'Loading…' : 'Select a notification'}
          </div>
        )}
      </div>
    </div>
  );
}

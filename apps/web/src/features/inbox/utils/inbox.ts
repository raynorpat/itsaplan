import type { Notification, NotificationType } from '@/types/notification';
import { isSnoozed } from '@/utils/notifications';

// What the inbox list shows, chosen in the browser from every unarchived
// notification of the viewer (Linear's NotificationFilter has no read or snooze
// conditions, so the inbox loads the whole list and filters it here).
export interface InboxFilters {
  showRead: boolean;
  showSnoozed: boolean;
  // Empty means every type.
  types: NotificationType[];
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  showRead: true,
  showSnoozed: false,
  types: [],
};

export function visibleNotifications(
  list: Notification[],
  filters: InboxFilters,
  now: Date,
): Notification[] {
  return list
    .filter((n) => {
      if (n.archivedAt != null) return false;
      if (!filters.showRead && n.readAt != null) return false;
      if (!filters.showSnoozed && isSnoozed(n, now)) return false;
      if (filters.types.length > 0 && !filters.types.includes(n.type)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// "Archive read for completed issues": read, unarchived notifications whose issue is
// completed or canceled.
export function readForCompletedIssues(list: Notification[]): Notification[] {
  return list.filter(
    (n) =>
      n.archivedAt == null &&
      n.readAt != null &&
      (n.issueStateType === 'completed' || n.issueStateType === 'canceled'),
  );
}

// The issues with unread, unarchived notifications, for "Mark all as read"
// (notificationMarkReadAll acts on one issue's notifications at a time).
export function issuesWithUnread(list: Notification[]): string[] {
  return [
    ...new Set(list.filter((n) => n.archivedAt == null && n.readAt == null).map((n) => n.issueId)),
  ];
}

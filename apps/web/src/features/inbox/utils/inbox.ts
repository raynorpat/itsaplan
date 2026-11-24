import type { Notification, NotificationType } from '@/types/notification';
import { isSnoozed } from '@/utils/notifications';
import {
  blocksShortcuts,
  matchesCombo,
  type HotkeyCombos,
  type KeyEventLike,
} from '@/utils/hotkeys';

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

// "Unsnooze all": the unarchived notifications still snoozed.
export function snoozedIds(list: Notification[], now: Date): string[] {
  return list.filter((n) => n.archivedAt == null && isSnoozed(n, now)).map((n) => n.id);
}

// E archives the open notification, as in Linear; never while typing or for a key
// another handler has taken.
export function inboxKeyAction(
  e: KeyEventLike & { target: EventTarget | null; defaultPrevented?: boolean },
  combos: HotkeyCombos,
  overlayOpen = false,
): 'archive' | null {
  if (overlayOpen || e.defaultPrevented || blocksShortcuts(e.target)) return null;
  return matchesCombo(e, combos['inbox.archive']) ? 'archive' : null;
}

// The verb phrase for a notification, addressed to the reader ("you"). A workflow's
// change names the workflow, marked as one.
export function notificationText(n: Notification): string {
  let who = n.actorName ?? 'Someone';
  if (n.actorName && n.actorWorkflow) who = `${n.actorName} (workflow)`;
  switch (n.type) {
    case 'assigned':
      return `${who} assigned the issue to you`;
    case 'mentioned':
      return `${who} mentioned you`;
    case 'commented':
      return `${who} commented`;
    case 'state_changed':
      return `${who} changed the status`;
    case 'agent_needs_input':
      return `${who} needs your input`;
    case 'agent_response':
      return `${who} responded`;
  }
}

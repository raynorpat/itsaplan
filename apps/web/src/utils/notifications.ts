import type { Notification } from '@/lib/api';

// Whether a notification is snoozed at `now`: a snooze time in the past no longer
// hides it.
export function isSnoozed(n: Pick<Notification, 'snoozedUntil'>, now: Date): boolean {
  return n.snoozedUntil != null && new Date(n.snoozedUntil).getTime() > now.getTime();
}

// The inbox badge: unread notifications that are neither archived nor snoozed. The
// sidebar and the inbox both read it from the loaded notification list.
export function unreadCount(list: Notification[], now: Date): number {
  return list.filter((n) => n.archivedAt == null && n.readAt == null && !isSnoozed(n, now)).length;
}

import type { Notification } from '@/types/notification';

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

// When the inbox next has to re-render on its own: the earliest snooze time still in
// the future among unarchived notifications, as epoch milliseconds, or null.
export function nextWakeUp(
  list: Pick<Notification, 'snoozedUntil' | 'archivedAt'>[],
  now: Date,
): number | null {
  let next: number | null = null;
  for (const n of list) {
    if (n.archivedAt != null || n.snoozedUntil == null) continue;
    const at = new Date(n.snoozedUntil).getTime();
    if (at > now.getTime() && (next == null || at < next)) next = at;
  }
  return next;
}

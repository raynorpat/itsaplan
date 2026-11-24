// Text and rules for the People pages: the requesters who gave feedback.

import type { WorkspaceRole } from '@/types/workspace';
import { formatShortDate } from '@/utils/dates';

const DAY_MS = 24 * 60 * 60 * 1000;

const utcDay = (d: Date) => Math.floor(d.getTime() / DAY_MS);

// When a person last gave feedback, relative to `now` for the past week.
export function lastFeedbackText(at: string | null, now: Date): string {
  if (!at) return 'No feedback yet';
  const days = utcDay(now) - utcDay(new Date(at));
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatShortDate(at);
}

export function feedbackCountText(count: number): string {
  if (count <= 0) return 'No feedback';
  return `${count} feedback ${count === 1 ? 'item' : 'items'}`;
}

export function mergeConfirmText(from: { name: string }, into: { name: string }): string {
  return `${from.name}'s feedback moves to ${into.name}, and ${from.name} is removed from the list. This cannot be undone.`;
}

// Merging cannot be undone, so the API allows it to owners and admins only.
export const canMergePeople = (role: WorkspaceRole | null): boolean =>
  role === 'owner' || role === 'admin';

// The auth client's JSON reader turns ISO timestamps into Date objects; the pages
// read them as strings.
export function isoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

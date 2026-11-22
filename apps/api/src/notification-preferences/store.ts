import { db, userPreference } from '@repo/db';
import { inArray, sql } from 'drizzle-orm';
import type { NotificationType } from '../notifications/store';

// A user's email notification preferences for the whole workspace, per Linear
// notification category (Linear's notificationCategoryPreferences, email channel).
// Stored on user_preference.notification_categories; null or a missing row means the
// defaults: email for assignments and mentions only.

export const CATEGORIES = [
  'assignments',
  'mentions',
  'commentsAndReplies',
  'statusChanges',
] as const;
export type Category = (typeof CATEGORIES)[number];
export type EmailCategories = Record<Category, boolean>;

// The category each inbox notification type belongs to.
export const CATEGORY_OF: Record<NotificationType, Category> = {
  assigned: 'assignments',
  mentioned: 'mentions',
  commented: 'commentsAndReplies',
  state_changed: 'statusChanges',
};

export function defaultCategories(): EmailCategories {
  return { assignments: true, mentions: true, commentsAndReplies: false, statusChanges: false };
}

// The stored value (possibly partial) over the defaults.
function toCategories(value: unknown): EmailCategories {
  const stored = (value ?? {}) as Partial<Record<Category, unknown>>;
  const result = defaultCategories();
  for (const c of CATEGORIES) if (typeof stored[c] === 'boolean') result[c] = stored[c] as boolean;
  return result;
}

export async function getEmailCategories(userId: string): Promise<EmailCategories> {
  const [row] = await db
    .select({ value: userPreference.notificationCategories })
    .from(userPreference)
    .where(sql`${userPreference.userId} = ${userId}`);
  return toCategories(row?.value);
}

// Changes the given categories and keeps the rest; returns the full set.
export async function setEmailCategories(
  userId: string,
  patch: Partial<EmailCategories>,
): Promise<EmailCategories> {
  const next = { ...(await getEmailCategories(userId)) };
  for (const c of CATEGORIES) if (typeof patch[c] === 'boolean') next[c] = patch[c] as boolean;
  await db
    .insert(userPreference)
    .values({ userId, notificationCategories: next })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { notificationCategories: next, updatedAt: sql`now()` },
    });
  return next;
}

// The email categories of several users, keyed by user id; users without stored
// preferences get the defaults. Used by the outbound enqueue path.
export async function getEmailCategoriesForUsers(
  userIds: string[],
): Promise<Map<string, EmailCategories>> {
  const result = new Map(userIds.map((id) => [id, defaultCategories()]));
  if (userIds.length === 0) return result;
  const rows = await db
    .select({ userId: userPreference.userId, value: userPreference.notificationCategories })
    .from(userPreference)
    .where(inArray(userPreference.userId, userIds));
  for (const r of rows) result.set(r.userId, toCategories(r.value));
  return result;
}

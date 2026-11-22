import { db, userPreference } from '@repo/db';
import { eq, sql } from 'drizzle-orm';

// A user's time zone (Linear's User.timezone). One row per user; absent means UTC, so
// a read never fails. Timestamps stay UTC everywhere in the API — `timezone` only
// tells the web app which zone to render them in. The other interface preferences
// are kept in the browser.

export interface UserPreferenceDto {
  timezone: string;
}

export type UserPreferencePatch = Partial<UserPreferenceDto>;

export function defaults(): UserPreferenceDto {
  return { timezone: 'UTC' };
}

// Whether a string is an IANA zone this runtime knows ('Europe/Berlin', 'UTC').
// Intl throws a RangeError for anything it cannot resolve.
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// A user's preferences, or the defaults when they have no row yet.
export async function getPreferences(userId: string): Promise<UserPreferenceDto> {
  const rows = await db
    .select({ timezone: userPreference.timezone })
    .from(userPreference)
    .where(eq(userPreference.userId, userId));
  return rows[0] ? { timezone: rows[0].timezone } : defaults();
}

// Applies a partial update and returns the full result. Fields left out keep their
// stored value, or take the default when there is no row yet.
export async function updatePreferences(
  userId: string,
  patch: UserPreferencePatch,
): Promise<UserPreferenceDto> {
  const next = { ...(await getPreferences(userId)), ...patch };
  await db
    .insert(userPreference)
    .values({ userId, ...next })
    .onConflictDoUpdate({
      target: userPreference.userId,
      set: { ...next, updatedAt: sql`now()` },
    });
  return next;
}

import { db, userNotificationPreference } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

// A member's own notification preferences for one team: for each issue event
// type, whether they want it by email. One row per (user, team); absent means the
// member has not opted in and receives nothing (opt-in default). Email is sent
// through the instance email provider.

// The issue events a member can subscribe to, matching the inbox notification types.
export const EVENT_KEYS = ['assigned', 'mentioned', 'commented', 'state_changed'] as const;
export type EventKey = (typeof EVENT_KEYS)[number];
export type EventToggles = Record<EventKey, boolean>;

export interface NotificationPreferenceDto {
  emailEvents: EventToggles;
}

function emptyEvents(): EventToggles {
  return { assigned: false, mentioned: false, commented: false, state_changed: false };
}

function defaults(): NotificationPreferenceDto {
  return { emailEvents: emptyEvents() };
}

// Normalizes the stored jsonb (possibly partial or empty {}) into a full EventToggles.
function toToggles(value: unknown): EventToggles {
  const o = (value ?? {}) as Partial<Record<EventKey, boolean>>;
  return {
    assigned: Boolean(o.assigned),
    mentioned: Boolean(o.mentioned),
    commented: Boolean(o.commented),
    state_changed: Boolean(o.state_changed),
  };
}

function toDto(row: { emailEvents: unknown }): NotificationPreferenceDto {
  return { emailEvents: toToggles(row.emailEvents) };
}

// A member's preferences for a team, or opt-in defaults (nothing enabled) when
// they have no row yet.
export async function getPreferences(
  userId: string,
  teamId: string,
): Promise<NotificationPreferenceDto> {
  const rows = await db
    .select({
      emailEvents: userNotificationPreference.emailEvents,
    })
    .from(userNotificationPreference)
    .where(
      and(
        eq(userNotificationPreference.userId, userId),
        eq(userNotificationPreference.teamId, teamId),
      ),
    );
  return rows[0] ? toDto(rows[0]) : defaults();
}

// Upserts a member's preferences for a team and returns the normalized result.
export async function setPreferences(
  userId: string,
  teamId: string,
  input: NotificationPreferenceDto,
): Promise<NotificationPreferenceDto> {
  const values = { emailEvents: input.emailEvents };
  await db
    .insert(userNotificationPreference)
    .values({ userId, teamId, ...values })
    .onConflictDoUpdate({
      target: [userNotificationPreference.userId, userNotificationPreference.teamId],
      set: { ...values, updatedAt: sql`now()` },
    });
  return toDto(values);
}

// Preferences for a set of members of one team, keyed by user id. Missing members
// (no row) are omitted; the caller treats them as opted out. Used by the outbound
// enqueue path to decide, per inbox row, whether that member wants the email.
export async function getPreferencesForUsers(
  teamId: string,
  userIds: string[],
): Promise<Map<string, NotificationPreferenceDto>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({
      userId: userNotificationPreference.userId,
      emailEvents: userNotificationPreference.emailEvents,
    })
    .from(userNotificationPreference)
    .where(
      and(
        eq(userNotificationPreference.teamId, teamId),
        inArray(userNotificationPreference.userId, userIds),
      ),
    );
  return new Map(rows.map((r) => [r.userId, toDto(r)]));
}

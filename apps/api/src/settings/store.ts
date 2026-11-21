import { db, teamSetting } from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';

// Instance settings (app_setting) are read through getSetting/setSetting in
// @repo/db, because @repo/auth reads them too.

// Per-team settings (team_setting): the same key-value store scoped to a
// team. Typed accessors per key live in the feature that owns the key (e.g.
// auto-archive in teams/store.ts).

export async function getTeamSetting<T>(teamId: string, key: string): Promise<T | null> {
  const rows = await db
    .select({ value: teamSetting.value })
    .from(teamSetting)
    .where(and(eq(teamSetting.teamId, teamId), eq(teamSetting.key, key)));
  return rows[0] ? (rows[0].value as T) : null;
}

export async function setTeamSetting(teamId: string, key: string, value: unknown): Promise<void> {
  await db
    .insert(teamSetting)
    .values({ teamId, key, value })
    .onConflictDoUpdate({
      target: [teamSetting.teamId, teamSetting.key],
      set: { value, updatedAt: sql`now()` },
    });
}

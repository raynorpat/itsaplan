import { db, externalUser } from '@repo/db';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { HttpError } from '../shared/lib';

// A requester's email update preferences (spec: requester updates). The main switch
// (`enabled`) is consent: on when the person confirms a portal sign-in or a form, or a
// member turns it on; unsubscribing turns it off and only the person can turn it on
// again. `changeEmails` and `summary` apply while it is on.

export type SummaryCadence = 'weekly' | 'daily' | 'off';
export const CADENCES: readonly SummaryCadence[] = ['weekly', 'daily', 'off'];

export interface UpdatePrefs {
  enabled: boolean;
  unsubscribed: boolean;
  changeEmails: boolean;
  summary: SummaryCadence;
}

type Row = typeof externalUser.$inferSelect;

export const prefsOf = (row: Row): UpdatePrefs => ({
  enabled: row.updatesEnabled,
  unsubscribed: row.updatesUnsubscribedAt != null,
  changeEmails: row.changeEmails,
  summary: row.summaryCadence as SummaryCadence,
});

async function load(requesterId: string): Promise<Row> {
  const [row] = await db.select().from(externalUser).where(eq(externalUser.id, requesterId));
  if (!row) throw new HttpError(404, 'Requester not found');
  return row;
}

export async function getPrefs(requesterId: string): Promise<UpdatePrefs> {
  return prefsOf(await load(requesterId));
}

// Turning updates on starts the change and summary windows now, so nothing that
// happened while they were off is sent. "Now" is the database's clock, which stamps the
// history and comments the windows are compared with (updates/clock.ts); the API's clock
// may run ahead of it, which would hide a change made just after opting in.
function turnedOn(): { updatesEnabled: true; changesSentUntil: SQL; summarySentUntil: SQL } {
  return { updatesEnabled: true, changesSentUntil: sql`now()`, summarySentUntil: sql`now()` };
}

// The person came to the team themselves (portal sign-in or form confirmed): updates
// on, unless they are on already or the person unsubscribed.
export async function optIn(requesterId: string): Promise<void> {
  await db
    .update(externalUser)
    .set(turnedOn())
    .where(
      and(
        eq(externalUser.id, requesterId),
        eq(externalUser.updatesEnabled, false),
        isNull(externalUser.updatesUnsubscribedAt),
      ),
    );
}

export type PrefsPatch = Partial<Pick<UpdatePrefs, 'enabled' | 'changeEmails' | 'summary'>>;

// Checks a patch from a request body: only known keys with the right types.
export function parsePatch(body: Record<string, unknown>, by: 'person' | 'team'): PrefsPatch {
  const patch: PrefsPatch = {};
  const keys = by === 'team' ? ['enabled'] : ['enabled', 'changeEmails', 'summary'];
  for (const key of Object.keys(body)) {
    if (!keys.includes(key)) throw new HttpError(400, `Unknown field ${key}`);
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'enabled must be a boolean');
    patch.enabled = body.enabled;
  }
  if (body.changeEmails !== undefined) {
    if (typeof body.changeEmails !== 'boolean')
      throw new HttpError(400, 'changeEmails must be a boolean');
    patch.changeEmails = body.changeEmails;
  }
  if (body.summary !== undefined) {
    if (!CADENCES.includes(body.summary as SummaryCadence))
      throw new HttpError(400, 'summary must be weekly, daily or off');
    patch.summary = body.summary as SummaryCadence;
  }
  return patch;
}

const unsubscribedError = () =>
  new HttpError(409, 'This person unsubscribed; only they can turn updates on');

// `team` (a member) may only set the main switch, and not for a person who
// unsubscribed (409). `person` turning it on clears their unsubscribe; turning it off
// records one.
export async function setPrefs(
  requesterId: string,
  patch: PrefsPatch,
  by: 'person' | 'team',
): Promise<UpdatePrefs> {
  const row = await load(requesterId);
  if (by === 'team' && (patch.changeEmails !== undefined || patch.summary !== undefined))
    throw new HttpError(400, 'Only the person can change these preferences');
  if (by === 'team' && patch.enabled && row.updatesUnsubscribedAt) throw unsubscribedError();
  const now = new Date();
  const values: { [K in keyof Row]?: Row[K] | SQL } = { updatedAt: now };
  if (patch.enabled === true && !row.updatesEnabled) Object.assign(values, turnedOn());
  if (patch.enabled === true && by === 'person') values.updatesUnsubscribedAt = null;
  if (patch.enabled === false) values.updatesEnabled = false;
  // The person turning updates off is their choice, kept like an unsubscribe: a later
  // sign-in or a member does not turn them on again.
  if (patch.enabled === false && by === 'person') values.updatesUnsubscribedAt = now;
  if (patch.changeEmails !== undefined) values.changeEmails = patch.changeEmails;
  if (patch.summary !== undefined) values.summaryCadence = patch.summary;
  const [updated] = await db
    .update(externalUser)
    .set(values)
    .where(
      and(
        eq(externalUser.id, requesterId),
        // An unsubscribe that lands between the read above and this write still wins.
        by === 'team' && patch.enabled ? isNull(externalUser.updatesUnsubscribedAt) : undefined,
      ),
    )
    .returning();
  if (!updated) throw unsubscribedError();
  return prefsOf(updated);
}

// Unsubscribing: every update off, recorded so neither a sign-in nor a member turns
// them on again.
export async function unsubscribe(requesterId: string): Promise<void> {
  const now = new Date();
  await db
    .update(externalUser)
    .set({ updatesEnabled: false, updatesUnsubscribedAt: now, updatedAt: now })
    .where(eq(externalUser.id, requesterId));
}

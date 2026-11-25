import { db, externalUser, portalSummaryCache } from '@repo/db';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { aiConfigured, aiSummary } from './ai';
import { requesterChanges, type Change } from './changes';
import { roundUp, type SummaryText } from './render';

// "Since your last visit" on the portal (spec: requester updates). A visit is recorded
// at most once an hour per person: the first portal request of a signed-in visitor an
// hour or more after the last recorded one moves `last_visit_at` to `previous_visit_at`.
// The round-up covers what changed on what the person follows since the previous visit;
// the AI paragraph (when an endpoint is set up) is written at most once per UTC day.

const VISIT_GAP_MS = 60 * 60_000;

// Records a visit when the last one is an hour old or more. Reads only the row the caller
// already loaded, so a request within the hour writes nothing.
export async function recordVisit(
  person: { id: string; lastVisitAt: Date | null },
  now = new Date(),
): Promise<void> {
  const gapStart = new Date(now.getTime() - VISIT_GAP_MS);
  if (person.lastVisitAt && person.lastVisitAt > gapStart) return;
  try {
    await db
      .update(externalUser)
      .set({ previousVisitAt: externalUser.lastVisitAt, lastVisitAt: now })
      .where(
        and(
          eq(externalUser.id, person.id),
          or(isNull(externalUser.lastVisitAt), lt(externalUser.lastVisitAt, gapStart)),
        ),
      );
  } catch (error) {
    // A visit is a convenience: a failure must not fail the request.
    console.error('[updates] recording a portal visit failed:', error);
  }
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function cachedParagraph(
  requesterId: string,
  changes: Change[],
  person: { displayName: string },
  now: Date,
): Promise<string | null> {
  if (!(await aiConfigured())) return null;
  const today = utcDay(now);
  const [cached] = await db
    .select()
    .from(portalSummaryCache)
    .where(eq(portalSummaryCache.requesterId, requesterId));
  if (cached?.day === today) return cached.text;
  const text = await aiSummary(changes, person);
  await db
    .insert(portalSummaryCache)
    .values({ requesterId, day: today, text })
    .onConflictDoUpdate({ target: portalSummaryCache.requesterId, set: { day: today, text } });
  return text;
}

export async function sinceLastVisit(requesterId: string, now = new Date()): Promise<SummaryText> {
  const [person] = await db
    .select({ displayName: externalUser.displayName, since: externalUser.previousVisitAt })
    .from(externalUser)
    .where(eq(externalUser.id, requesterId));
  if (!person?.since) return { paragraph: null, lines: [] };
  const changes = await requesterChanges(requesterId, person.since, now);
  if (changes.length === 0) return { paragraph: null, lines: [] };
  return {
    paragraph: await cachedParagraph(requesterId, changes, person, now),
    lines: roundUp(changes),
  };
}

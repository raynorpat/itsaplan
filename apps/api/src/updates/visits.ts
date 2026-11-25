import { db, externalUser, portalSummaryCache } from '@repo/db';
import { createHash } from 'node:crypto';
import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { aiConfigured, aiSummary } from './ai';
import { dbNow } from './clock';
import { requesterChanges, type Change } from './changes';
import { roundUp, type SummaryText } from './render';

// "Since your last visit" on the portal (spec: requester updates). A visit is recorded
// at most once an hour per person: the first portal request of a signed-in visitor an
// hour or more after the last recorded one moves `last_visit_at` to `previous_visit_at`.
// The round-up covers what changed on what the person follows since the previous visit;
// the AI paragraph (when an endpoint is set up) is written at most once per UTC day.

const VISIT_GAP_MS = 60 * 60_000;

// Records a visit when the last one is an hour old or more. Reads only the row the caller
// already loaded, so a request within the hour writes nothing. The visit is stamped with
// the database's clock, which stamps the changes it is compared with.
export async function recordVisit(person: { id: string; lastVisitAt: Date | null }): Promise<void> {
  const gapStart = new Date(Date.now() - VISIT_GAP_MS);
  if (person.lastVisitAt && person.lastVisitAt > gapStart) return;
  try {
    await db
      .update(externalUser)
      .set({ previousVisitAt: externalUser.lastVisitAt, lastVisitAt: sql`now()` })
      .where(
        and(
          eq(externalUser.id, person.id),
          or(
            isNull(externalUser.lastVisitAt),
            lt(externalUser.lastVisitAt, sql`now() - interval '1 hour'`),
          ),
        ),
      );
  } catch (error) {
    // A visit is a convenience: a failure must not fail the request.
    console.error('[updates] recording a portal visit failed:', error);
  }
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

// How long the page waits for the day's paragraph; a slower model fills the cache for
// the next load and this answer shows the round-up alone.
const PARAGRAPH_WAIT_MS = 5_000;

const changesHash = (since: Date, changes: Change[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        since.toISOString(),
        changes.map((c) => [
          c.kind,
          c.at.toISOString(),
          'issueId' in c ? c.issueId : c.projectName,
        ]),
      ]),
    )
    .digest('hex');

// The day's paragraph for these changes. The model is asked at most once per person per
// UTC day: the first request of the day claims the cache row, so a second tab waits for
// nothing and shows the round-up. A paragraph is shown only while the changes and the
// visit it was written for are still the ones on screen.
async function cachedParagraph(
  requesterId: string,
  since: Date,
  changes: Change[],
  person: { displayName: string },
  now: Date,
  waitMs: number,
): Promise<string | null> {
  if (!(await aiConfigured())) return null;
  const today = utcDay(now);
  const hash = changesHash(since, changes);
  const [cached] = await db
    .select()
    .from(portalSummaryCache)
    .where(eq(portalSummaryCache.requesterId, requesterId));
  if (cached?.day === today) return cached.changesHash === hash ? cached.text : null;
  const [claimed] = await db
    .insert(portalSummaryCache)
    .values({ requesterId, day: today, text: null, changesHash: hash })
    .onConflictDoUpdate({
      target: portalSummaryCache.requesterId,
      set: { day: today, text: null, changesHash: hash },
      setWhere: ne(portalSummaryCache.day, today),
    })
    .returning();
  if (!claimed) return null;
  const written = aiSummary(changes, person).then(async (text) => {
    try {
      await db
        .update(portalSummaryCache)
        .set({ text })
        .where(
          and(
            eq(portalSummaryCache.requesterId, requesterId),
            eq(portalSummaryCache.day, today),
            eq(portalSummaryCache.changesHash, hash),
          ),
        );
    } catch (error) {
      console.error('[updates] caching the portal summary failed:', error);
    }
    return text;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([written, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sinceLastVisit(
  requesterId: string,
  at?: Date,
  options: { waitMs?: number } = {},
): Promise<SummaryText> {
  const now = at ?? (await dbNow());
  const [person] = await db
    .select({ displayName: externalUser.displayName, since: externalUser.previousVisitAt })
    .from(externalUser)
    .where(eq(externalUser.id, requesterId));
  if (!person?.since) return { paragraph: null, lines: [] };
  const changes = await requesterChanges(requesterId, person.since, now);
  if (changes.length === 0) return { paragraph: null, lines: [] };
  return {
    paragraph: await cachedParagraph(
      requesterId,
      person.since,
      changes,
      person,
      now,
      options.waitMs ?? PARAGRAPH_WAIT_MS,
    ),
    lines: roundUp(changes),
  };
}

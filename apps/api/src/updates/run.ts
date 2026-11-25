import { db, externalUser, organization } from '@repo/db';
import { getNotificationEmailConfig } from '@repo/auth';
import { sendEmail, type EmailConfig } from '@repo/mailer';
import { and, eq, isNotNull, isNull, lt, lte, min, notInArray, or, type SQL } from 'drizzle-orm';
import { webOrigin } from '../portal/session';
import { aiConfigured, aiSummary } from './ai';
import { requesterChanges, requestersWithChangesSince, type Change } from './changes';
import { renderChangeEmail, renderSummaryEmail, roundUp, type SummaryText } from './render';
import { unsubscribeToken } from './unsubscribe';

// The worker-triggered runs that mail requesters (spec: requester updates): change emails
// (at most one per person per 10 minutes, each change once) and the weekly or daily
// summary (Mondays or every day, 08:00 UTC, only when something is new). Each person is
// claimed with a conditional UPDATE on their own marker before anything is sent, so two
// runs never mail the same person for the same window; no transaction is held while
// sending. A failed send puts the claim back, so the next run sends the same changes.
// Without a mail provider nothing is sent and nothing is marked.
//
// `now` is the database's clock (the internal routes read it). A run covers changes up to
// 30 seconds before it: history and comments are stamped when their transaction starts,
// so a change still being committed at `now` is picked up by the next run instead of
// falling behind the marker.

const CHANGE_EMAIL_GAP_MS = 10 * 60_000;
// A change email waits until the person's latest change is 5 minutes old (a burst of
// edits becomes one email, and flips that end where they started send nothing), but no
// longer than 30 minutes after their first unsent change.
const QUIET_MS = 5 * 60_000;
const MAX_WAIT_MS = 30 * 60_000;
export const SETTLE_MS = 30_000;
const SUMMARY_HOUR_UTC = 8;

type Person = typeof externalUser.$inferSelect;

// People who may get anything at all: updates on, an email, not blocked or merged.
const reachable: SQL = and(
  eq(externalUser.updatesEnabled, true),
  isNotNull(externalUser.email),
  isNull(externalUser.portalBlockedAt),
  isNull(externalUser.mergedIntoId),
)!;

// Within one run: once the AI endpoint fails, the rest of the run does not wait on it.
export interface AiState {
  down: boolean;
}

// The text of a summary: the paragraph the AI endpoint writes (null without one, or when
// it fails) above the round-up.
export async function summaryText(
  changes: Change[],
  person: { displayName: string },
  ai: AiState = { down: false },
): Promise<SummaryText> {
  const lines = roundUp(changes);
  if (ai.down) return { paragraph: null, lines };
  const paragraph = await aiSummary(changes, person);
  if (paragraph === null && (await aiConfigured())) ai.down = true;
  return { paragraph, lines };
}

async function workspaceName(): Promise<string> {
  const [org] = await db.select({ name: organization.name }).from(organization).limit(1);
  return org?.name ?? 'Workspace';
}

// The configured From address with the workspace's name as the sender name.
function withSenderName(config: EmailConfig, name: string): EmailConfig {
  const from = config.from || process.env.EMAIL_FROM || config.smtp.username;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  if (!address.includes('@')) return config;
  const safe = name.replace(/["\\\r\n<>]/g, '').trim() || 'Workspace';
  return { ...config, from: `"${safe}" <${address}>` };
}

const apiOrigin = () => (process.env.API_URL ?? '').replace(/\/+$/, '');

function unsubscribeLinks(requesterId: string): { page: string; headers: Record<string, string> } {
  const token = encodeURIComponent(unsubscribeToken(requesterId));
  return {
    page: `${webOrigin()}/portal/unsubscribe?token=${token}`,
    headers: {
      'List-Unsubscribe': `<${apiOrigin()}/portal/unsubscribe/one-click?token=${token}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

interface Mailer {
  config: EmailConfig;
  workspace: string;
}

async function mailer(): Promise<Mailer | null> {
  const config = await getNotificationEmailConfig();
  if (!config) return null;
  const workspace = await workspaceName();
  return { config: withSenderName(config, workspace), workspace };
}

async function send(
  m: Mailer,
  person: Person,
  mail: { subject: string; text: string; html: string },
  headers: Record<string, string>,
): Promise<boolean> {
  const result = await sendEmail(m.config, { to: person.email!, ...mail, headers });
  if (!result.ok) console.error('[updates] email to a requester failed:', result.error);
  return result.ok;
}

// --- Change emails ----------------------------------------------------------------

// One person's step must not stop the run for everyone else.
async function each(ids: string[], step: (id: string) => Promise<boolean>): Promise<number> {
  let sent = 0;
  for (const id of ids) {
    try {
      if (await step(id)) sent++;
    } catch (error) {
      console.error('[updates] a requester update step failed:', error);
    }
  }
  return sent;
}

export async function runChangeEmails(now: Date): Promise<{ sent: number }> {
  const m = await mailer();
  if (!m) return { sent: 0 };
  const until = new Date(now.getTime() - SETTLE_MS);
  const gapStart = new Date(now.getTime() - CHANGE_EMAIL_GAP_MS);
  const ready = and(
    reachable,
    eq(externalUser.changeEmails, true),
    or(isNull(externalUser.lastChangeEmailAt), lte(externalUser.lastChangeEmailAt, gapStart)),
  );
  const [oldest] = await db
    .select({ at: min(externalUser.changesSentUntil) })
    .from(externalUser)
    .where(ready);
  if (!oldest?.at) return { sent: 0 };
  const candidates = await requestersWithChangesSince(oldest.at);
  const sent = await each(candidates, (id) => changeEmailFor(m, id, now, until, gapStart));
  // Everyone else who was ready had nothing after their marker: their window moves on, so
  // the next run's lookup starts from recent history instead of their opt-in time.
  await db
    .update(externalUser)
    .set({ changesSentUntil: until })
    .where(
      and(
        ready,
        or(isNull(externalUser.changesSentUntil), lt(externalUser.changesSentUntil, until)),
        candidates.length > 0 ? notInArray(externalUser.id, candidates) : undefined,
      ),
    );
  return { sent };
}

async function changeEmailFor(
  m: Mailer,
  id: string,
  now: Date,
  until: Date,
  gapStart: Date,
): Promise<boolean> {
  const [person] = await db.select().from(externalUser).where(eq(externalUser.id, id));
  if (!person || !person.changeEmails) return false;
  const previous = person.lastChangeEmailAt;
  // The claim: only one run gets the person while their 10 minutes are up.
  const [claimed] = await db
    .update(externalUser)
    .set({ lastChangeEmailAt: now })
    .where(
      and(
        eq(externalUser.id, id),
        reachable,
        eq(externalUser.changeEmails, true),
        or(isNull(externalUser.lastChangeEmailAt), lte(externalUser.lastChangeEmailAt, gapStart)),
      ),
    )
    .returning();
  if (!claimed) return false;
  const release = () =>
    db.update(externalUser).set({ lastChangeEmailAt: previous }).where(eq(externalUser.id, id));
  try {
    const since = claimed.changesSentUntil ?? until;
    if (since >= until) {
      await release();
      return false;
    }
    const changes = await requesterChanges(id, since, until);
    if (changes.length === 0) {
      // Nothing to send: the window is covered, and the 10 minutes are not used up.
      await db
        .update(externalUser)
        .set({ lastChangeEmailAt: previous, changesSentUntil: until })
        .where(eq(externalUser.id, id));
      return false;
    }
    const newest = changes[changes.length - 1]!.at.getTime();
    const first = changes[0]!.at.getTime();
    if (now.getTime() - newest < QUIET_MS && now.getTime() - first < MAX_WAIT_MS) {
      await release();
      return false;
    }
    const links = unsubscribeLinks(id);
    const ok = await send(
      m,
      claimed,
      renderChangeEmail(changes, claimed, m.workspace, links.page),
      links.headers,
    );
    if (!ok) {
      await release();
      return false;
    }
    await markSent(id, { changesSentUntil: until });
    return true;
  } catch (error) {
    await release();
    throw error;
  }
}

// After a sent email: a failed write here means the same changes go out again later, so
// it is logged.
async function markSent(id: string, values: Partial<Person>): Promise<void> {
  try {
    await db.update(externalUser).set(values).where(eq(externalUser.id, id));
  } catch (error) {
    console.error(
      '[updates] recording a sent requester email failed; it may be sent again:',
      error,
    );
  }
}

// --- Summaries --------------------------------------------------------------------

// The latest summary time at or before `now`: today's 08:00 UTC (daily), or this week's
// Monday 08:00 UTC (weekly).
export function summaryBoundary(now: Date, cadence: 'weekly' | 'daily'): Date {
  const b = new Date(now);
  b.setUTCHours(SUMMARY_HOUR_UTC, 0, 0, 0);
  if (b > now) b.setUTCDate(b.getUTCDate() - 1);
  if (cadence === 'weekly') {
    while (b.getUTCDay() !== 1) b.setUTCDate(b.getUTCDate() - 1);
  }
  return b;
}

export async function runSummaries(now: Date): Promise<{ sent: number }> {
  const m = await mailer();
  if (!m) return { sent: 0 };
  const until = new Date(now.getTime() - SETTLE_MS);
  const ai: AiState = { down: false };
  let sent = 0;
  for (const cadence of ['weekly', 'daily'] as const) {
    // From `until`, so the marker written below is never before the boundary.
    const boundary = summaryBoundary(until, cadence);
    const due = await db
      .select({ id: externalUser.id })
      .from(externalUser)
      .where(and(reachable, eq(externalUser.summaryCadence, cadence), dueBefore(boundary)));
    sent += await each(
      due.map((d) => d.id),
      (id) => summaryFor(m, id, cadence, boundary, until, ai),
    );
  }
  return { sent };
}

const dueBefore = (boundary: Date) =>
  or(isNull(externalUser.summarySentUntil), lt(externalUser.summarySentUntil, boundary));

async function summaryFor(
  m: Mailer,
  id: string,
  cadence: 'weekly' | 'daily',
  boundary: Date,
  until: Date,
  ai: AiState,
): Promise<boolean> {
  const [person] = await db.select().from(externalUser).where(eq(externalUser.id, id));
  if (!person) return false;
  const previous = person.summarySentUntil;
  const [claimed] = await db
    .update(externalUser)
    .set({ summarySentUntil: until })
    .where(
      and(
        eq(externalUser.id, id),
        reachable,
        eq(externalUser.summaryCadence, cadence),
        dueBefore(boundary),
      ),
    )
    .returning();
  if (!claimed) return false;
  const release = () =>
    db.update(externalUser).set({ summarySentUntil: previous }).where(eq(externalUser.id, id));
  try {
    // A person who never had a summary: the period before this one.
    const since =
      previous ?? new Date(boundary.getTime() - (cadence === 'weekly' ? 7 : 1) * 86_400_000);
    const changes = await requesterChanges(id, since, until);
    // Nothing new: the period is covered without an email.
    if (changes.length === 0) return false;
    const links = unsubscribeLinks(id);
    const text = await summaryText(changes, claimed, ai);
    const ok = await send(
      m,
      claimed,
      renderSummaryEmail(text, claimed, m.workspace, links.page, cadence),
      links.headers,
    );
    if (!ok) await release();
    return ok;
  } catch (error) {
    await release();
    throw error;
  }
}

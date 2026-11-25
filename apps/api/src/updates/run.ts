import { db, externalUser, organization } from '@repo/db';
import { getNotificationEmailConfig } from '@repo/auth';
import { sendEmail, type EmailConfig } from '@repo/mailer';
import { and, eq, isNotNull, isNull, lt, lte, min, or, type SQL } from 'drizzle-orm';
import { webOrigin } from '../portal/session';
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

const CHANGE_EMAIL_GAP_MS = 10 * 60_000;
const SUMMARY_HOUR_UTC = 8;

type Person = typeof externalUser.$inferSelect;

// People who may get anything at all: updates on, an email, not blocked or merged.
const reachable: SQL = and(
  eq(externalUser.updatesEnabled, true),
  isNotNull(externalUser.email),
  isNull(externalUser.portalBlockedAt),
  isNull(externalUser.mergedIntoId),
)!;

// The text of a summary. Without an AI endpoint, the round-up alone.
export async function summaryText(
  changes: Change[],
  _person: { displayName: string },
): Promise<SummaryText> {
  return { paragraph: null, lines: roundUp(changes) };
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

export async function runChangeEmails(now: Date): Promise<{ sent: number }> {
  const m = await mailer();
  if (!m) return { sent: 0 };
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
  if (!oldest) return { sent: 0 };
  const candidates = await requestersWithChangesSince(oldest.at ?? now);
  let sent = 0;
  for (const id of candidates) {
    if (await changeEmailFor(m, id, now, gapStart)) sent++;
  }
  return { sent };
}

async function changeEmailFor(m: Mailer, id: string, now: Date, gapStart: Date): Promise<boolean> {
  const [person] = await db.select().from(externalUser).where(eq(externalUser.id, id));
  if (!person || !person.changeEmails) return false;
  const previous = person.lastChangeEmailAt;
  if (previous && previous > gapStart) return false;
  // The claim: only the run whose UPDATE still sees the old value goes on.
  const [claimed] = await db
    .update(externalUser)
    .set({ lastChangeEmailAt: now })
    .where(
      and(
        eq(externalUser.id, id),
        reachable,
        eq(externalUser.changeEmails, true),
        previous
          ? eq(externalUser.lastChangeEmailAt, previous)
          : isNull(externalUser.lastChangeEmailAt),
      ),
    )
    .returning();
  if (!claimed) return false;
  const release = () =>
    db.update(externalUser).set({ lastChangeEmailAt: previous }).where(eq(externalUser.id, id));
  const since = claimed.changesSentUntil ?? now;
  if (since >= now) {
    await release();
    return false;
  }
  let changes: Change[];
  try {
    changes = await requesterChanges(id, since, now);
  } catch (error) {
    await release();
    throw error;
  }
  if (changes.length === 0) {
    // Nothing to send: the window is covered, and the 10 minutes are not used up.
    await db
      .update(externalUser)
      .set({ lastChangeEmailAt: previous, changesSentUntil: now })
      .where(eq(externalUser.id, id));
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
  await db.update(externalUser).set({ changesSentUntil: now }).where(eq(externalUser.id, id));
  return true;
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
  let sent = 0;
  for (const cadence of ['weekly', 'daily'] as const) {
    const boundary = summaryBoundary(now, cadence);
    const due = await db
      .select({ id: externalUser.id })
      .from(externalUser)
      .where(
        and(
          reachable,
          eq(externalUser.summaryCadence, cadence),
          or(isNull(externalUser.summarySentUntil), lt(externalUser.summarySentUntil, boundary)),
        ),
      );
    for (const { id } of due) {
      if (await summaryFor(m, id, cadence, boundary, now)) sent++;
    }
  }
  return { sent };
}

async function summaryFor(
  m: Mailer,
  id: string,
  cadence: 'weekly' | 'daily',
  boundary: Date,
  now: Date,
): Promise<boolean> {
  const [person] = await db.select().from(externalUser).where(eq(externalUser.id, id));
  if (!person) return false;
  const previous = person.summarySentUntil;
  if (previous && previous >= boundary) return false;
  const [claimed] = await db
    .update(externalUser)
    .set({ summarySentUntil: now })
    .where(
      and(
        eq(externalUser.id, id),
        reachable,
        eq(externalUser.summaryCadence, cadence),
        previous
          ? eq(externalUser.summarySentUntil, previous)
          : isNull(externalUser.summarySentUntil),
      ),
    )
    .returning();
  if (!claimed) return false;
  const release = () =>
    db.update(externalUser).set({ summarySentUntil: previous }).where(eq(externalUser.id, id));
  // A person who never had a summary: the period before this one.
  const since =
    previous ?? new Date(boundary.getTime() - (cadence === 'weekly' ? 7 : 1) * 86_400_000);
  let changes: Change[];
  try {
    changes = await requesterChanges(id, since, now);
  } catch (error) {
    await release();
    throw error;
  }
  // Nothing new: the period is covered without an email.
  if (changes.length === 0) return false;
  const links = unsubscribeLinks(id);
  const text = await summaryText(changes, claimed);
  const ok = await send(
    m,
    claimed,
    renderSummaryEmail(text, claimed, m.workspace, links.page, cadence),
    links.headers,
  );
  if (!ok) await release();
  return ok;
}

import {
  attachment,
  customerNeed,
  db,
  externalUser,
  issue,
  portalSession,
  team,
  workflowState,
} from '@repo/db';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  atLeast,
  canSeeTeam,
  visibleTeamIds,
  workspaceRole,
  type AuthUser,
} from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { parsePatch, setPrefs } from '../updates/preferences';
import { assertFeedbackWrite, readsFeedback } from './access';
import { retitleFeedbackAttachments } from '../attachments/store';
import { activeRequester, createRequesterAttachment } from './store';

// Requesters (Linear's ExternalUser): people outside the workspace who give feedback.
// Linear's schema has no mutation for them, so the web manages them through the
// instance plugin (/api/auth/instance/requesters*). Owners, admins and members find,
// create and edit them; owners and admins merge them; guests (and app users) do
// nothing. One active requester per lowercased email; a merged requester keeps its row
// (`merged_into_id`), so links and its email still lead to the one kept.

export interface RequesterDto {
  id: string;
  name: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  createdAt: string;
  feedbackCount: number;
  lastFeedbackAt: string | null;
  // The person's first active feedback (on an issue the user can see), for "new people".
  firstFeedbackAt: string | null;
  // Blocked from the portal: no portal sign-in, sessions ended.
  portalBlocked: boolean;
  // Email updates: on, and whether the person unsubscribed (then only they turn it on).
  updates: { enabled: boolean; unsubscribed: boolean };
}

const PAGE = 50;
const MAX_NAME = 255;

async function assertMember(userId: string): Promise<void> {
  if (!(await readsFeedback(userId))) throw new HttpError(403, 'Guests cannot see requesters');
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, 'name is required');
  const name = value.trim();
  if (name.length > MAX_NAME) throw new HttpError(400, `name is at most ${MAX_NAME} characters`);
  return name;
}

function cleanEmail(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'email must be a string');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
    throw new HttpError(400, 'email is not a valid address');
  return email;
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value))
    throw new HttpError(400, `${what} must be an id`);
  return value;
}

const isUniqueViolation = (err: unknown): boolean =>
  ((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) ===
  '23505';

const resolveRequester = activeRequester;

// The active requester an email leads to: its owner, or (for a merged requester's
// email) the one it was merged into.
export async function requesterByEmail(email: string) {
  const [active] = await db
    .select()
    .from(externalUser)
    .where(and(eq(externalUser.email, email), isNull(externalUser.mergedIntoId)));
  if (active) return active;
  const [merged] = await db
    .select({ id: externalUser.id })
    .from(externalUser)
    .where(eq(externalUser.email, email))
    .orderBy(desc(externalUser.updatedAt))
    .limit(1);
  return merged ? resolveRequester(merged.id) : null;
}

interface FeedbackStats {
  count: number;
  last: string | null;
  first: string | null;
}

// Feedback counts per requester, over feedback on issues the user can see.
async function feedbackStats(userId: string, ids: string[]): Promise<Map<string, FeedbackStats>> {
  const out = new Map<string, FeedbackStats>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      requesterId: attachment.externalUserCreatorId,
      count: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${customerNeed.createdAt})`,
      first: sql<Date | null>`min(${customerNeed.createdAt}) filter (where ${customerNeed.archivedAt} is null)`,
    })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .innerJoin(issue, eq(issue.id, customerNeed.issueId))
    .where(
      and(
        inArray(attachment.externalUserCreatorId, ids),
        inArray(issue.teamId, visibleTeamIds(userId)),
      ),
    )
    .groupBy(attachment.externalUserCreatorId);
  for (const r of rows)
    if (r.requesterId)
      out.set(r.requesterId, {
        count: r.count,
        last: r.last ? iso(new Date(r.last)) : null,
        first: r.first ? iso(new Date(r.first)) : null,
      });
  return out;
}

function toDto(
  row: typeof externalUser.$inferSelect,
  stats: FeedbackStats | undefined,
): RequesterDto {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    email: row.email,
    avatarUrl: row.avatarUrl,
    createdAt: iso(row.createdAt),
    feedbackCount: stats?.count ?? 0,
    lastFeedbackAt: stats?.last ?? null,
    firstFeedbackAt: stats?.first ?? null,
    portalBlocked: row.portalBlockedAt != null,
    updates: { enabled: row.updatesEnabled, unsubscribed: row.updatesUnsubscribedAt != null },
  };
}

async function dtoOf(userId: string, row: typeof externalUser.$inferSelect) {
  return toDto(row, (await feedbackStats(userId, [row.id])).get(row.id));
}

// Active requesters ordered by name, searched by name or email, paged by `cursor`
// (the offset of the next page).
export async function listRequesters(
  userId: string,
  query: { q?: unknown; cursor?: unknown },
): Promise<{ requesters: RequesterDto[]; nextCursor: string | null }> {
  await assertMember(userId);
  const offset =
    typeof query.cursor === 'string' && /^\d+$/.test(query.cursor) ? Number(query.cursor) : 0;
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db
    .select()
    .from(externalUser)
    .where(
      and(
        isNull(externalUser.mergedIntoId),
        q ? or(ilike(externalUser.name, pattern), ilike(externalUser.email, pattern)) : undefined,
      ),
    )
    .orderBy(asc(sql`lower(${externalUser.name})`), asc(externalUser.id))
    .limit(PAGE + 1)
    .offset(offset);
  const page = rows.slice(0, PAGE);
  const stats = await feedbackStats(
    userId,
    page.map((r) => r.id),
  );
  return {
    requesters: page.map((r) => toDto(r, stats.get(r.id))),
    nextCursor: rows.length > PAGE ? String(offset + PAGE) : null,
  };
}

export interface RequesterIssueFeedback {
  issue: {
    id: string;
    identifier: string;
    title: string;
    archivedAt: string | null;
    state: { name: string; type: string; color: string };
  };
  feedback: {
    id: string;
    body: string | null;
    priority: number;
    createdAt: string;
    archivedAt: string | null;
  }[];
}

// One requester (following a merge) with their feedback on issues the user can see,
// grouped by issue, newest feedback first.
export async function getRequester(
  userId: string,
  idValue: unknown,
): Promise<RequesterDto & { issues: RequesterIssueFeedback[] }> {
  await assertMember(userId);
  const row = await resolveRequester(requireId(idValue, 'id'));
  if (!row) throw new HttpError(404, 'Requester not found');
  const rows = await db
    .select({
      needId: customerNeed.id,
      body: customerNeed.body,
      priority: customerNeed.priority,
      createdAt: customerNeed.createdAt,
      needArchivedAt: customerNeed.archivedAt,
      issueId: issue.id,
      teamKey: team.key,
      number: issue.sequenceNumber,
      title: issue.title,
      archivedAt: issue.archivedAt,
      stateName: workflowState.name,
      stateType: workflowState.stateType,
      stateColor: workflowState.color,
    })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .innerJoin(issue, eq(issue.id, customerNeed.issueId))
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(
      and(
        eq(attachment.externalUserCreatorId, row.id),
        inArray(issue.teamId, visibleTeamIds(userId)),
      ),
    )
    .orderBy(desc(customerNeed.createdAt));
  const byIssue = new Map<string, RequesterIssueFeedback>();
  for (const r of rows) {
    let group = byIssue.get(r.issueId);
    if (!group) {
      group = {
        issue: {
          id: r.issueId,
          identifier: `${r.teamKey}-${r.number}`,
          title: r.title,
          archivedAt: r.archivedAt ? iso(r.archivedAt) : null,
          state: { name: r.stateName, type: r.stateType, color: r.stateColor },
        },
        feedback: [],
      };
      byIssue.set(r.issueId, group);
    }
    group.feedback.push({
      id: r.needId,
      body: r.body,
      priority: r.priority,
      createdAt: iso(r.createdAt),
      archivedAt: r.needArchivedAt ? iso(r.needArchivedAt) : null,
    });
  }
  return { ...(await dtoOf(userId, row)), issues: [...byIssue.values()] };
}

// Creates a requester, or returns the one an email already leads to.
export async function createRequester(
  userId: string,
  body: { name?: unknown; email?: unknown },
): Promise<RequesterDto> {
  await assertMember(userId);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  if (email) {
    const existing = await requesterByEmail(email);
    if (existing) return dtoOf(userId, existing);
  }
  try {
    const [row] = await db
      .insert(externalUser)
      .values({ name, displayName: name, email, createdById: userId })
      .returning();
    return dtoOf(userId, row!);
  } catch (err) {
    // Another request created the same email in the meantime.
    if (email && isUniqueViolation(err)) {
      const existing = await requesterByEmail(email);
      if (existing) return dtoOf(userId, existing);
    }
    throw err;
  }
}

export async function updateRequester(
  userId: string,
  body: { id?: unknown; name?: unknown; email?: unknown },
): Promise<RequesterDto> {
  await assertMember(userId);
  const row = await resolveRequester(requireId(body.id, 'id'));
  if (!row) throw new HttpError(404, 'Requester not found');
  const patch: Partial<typeof externalUser.$inferInsert> = {};
  if (body.name !== undefined) {
    patch.name = cleanName(body.name);
    patch.displayName = patch.name;
  }
  if (body.email !== undefined) {
    const email = cleanEmail(body.email);
    if (email && email !== row.email) {
      const owner = await requesterByEmail(email);
      if (owner && owner.id !== row.id)
        throw new HttpError(409, 'Another person has this email address');
    }
    patch.email = email;
  }
  if (Object.keys(patch).length === 0) return dtoOf(userId, row);
  try {
    const { updated, announce } = await db.transaction(async (tx) => {
      const [saved] = await tx
        .update(externalUser)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(eq(externalUser.id, row.id))
        .returning();
      // A portal session stands for the address that signed in; a changed email ends
      // the person's sessions.
      if (patch.email !== undefined && patch.email !== row.email)
        await tx.delete(portalSession).where(eq(portalSession.externalUserId, row.id));
      // The feedback attachments show the requester's name as their title.
      const sendEvents = patch.displayName
        ? await retitleFeedbackAttachments(tx, row.id, { title: patch.displayName })
        : null;
      return { updated: saved!, announce: sendEvents };
    });
    if (announce) await announce(userId);
    return dtoOf(userId, updated);
  } catch (err) {
    if (isUniqueViolation(err)) throw new HttpError(409, 'Another person has this email address');
    throw err;
  }
}

// Merges `fromId` into `intoId`: A's feedback becomes B's (a person counts once per
// issue), A stays as a row pointing at B, so links and A's email lead to B. B takes
// A's email when B has none.
export async function mergeRequesters(
  user: AuthUser,
  body: { fromId?: unknown; intoId?: unknown },
): Promise<RequesterDto> {
  await assertMember(user.id);
  if (!atLeast(await workspaceRole(user.id), 'admin'))
    throw new HttpError(403, 'Only owners and admins can merge people');
  const fromId = requireId(body.fromId, 'fromId');
  const intoId = requireId(body.intoId, 'intoId');
  const from = await resolveRequester(fromId);
  const into = await resolveRequester(intoId);
  if (!from || !into) throw new HttpError(404, 'Requester not found');
  if (from.id === into.id) throw new HttpError(400, 'A person cannot be merged into themselves');
  const { kept, announce } = await db.transaction(async (tx) => {
    // Both rows are locked and re-read: a merge that ran meanwhile (B into A while
    // this merges A into B) is seen here and this one is refused, so two people never
    // end up pointing at each other.
    const locked = await tx
      .select()
      .from(externalUser)
      .where(inArray(externalUser.id, [from.id, into.id]))
      .orderBy(asc(externalUser.id))
      .for('update');
    if (locked.length !== 2 || locked.some((r) => r.mergedIntoId))
      throw new HttpError(409, 'One of these people was merged meanwhile; reload and try again');
    const sendEvents = await retitleFeedbackAttachments(tx, from.id, {
      title: into.displayName,
      externalUserCreatorId: into.id,
    });
    const takeEmail = !into.email && from.email;
    // An unsubscribe by either person stays with the person kept (they are one person),
    // so the merge never turns emails back on for an address that asked to stop.
    const lockedFrom = locked.find((r) => r.id === from.id)!;
    const lockedInto = locked.find((r) => r.id === into.id)!;
    const unsubscribedAt = lockedInto.updatesUnsubscribedAt ?? lockedFrom.updatesUnsubscribedAt;
    const keepUnsubscribe = unsubscribedAt
      ? { updatesEnabled: false, updatesUnsubscribedAt: unsubscribedAt }
      : {};
    // Both people sign in to the portal again, as the person kept.
    await tx.delete(portalSession).where(inArray(portalSession.externalUserId, [from.id, into.id]));
    await tx
      .update(externalUser)
      .set({ mergedIntoId: into.id, updatedAt: sql`now()` })
      .where(eq(externalUser.id, from.id));
    // Earlier merges into A now point at B directly.
    await tx
      .update(externalUser)
      .set({ mergedIntoId: into.id })
      .where(eq(externalUser.mergedIntoId, from.id));
    const [row] = await tx
      .update(externalUser)
      .set({
        ...(takeEmail ? { email: from.email } : {}),
        ...keepUnsubscribe,
        updatedAt: sql`now()`,
      })
      .where(eq(externalUser.id, into.id))
      .returning();
    return { kept: row!, announce: sendEvents };
  });
  await announce(user.id);
  return dtoOf(user.id, kept);
}

// The source attachment naming a feedback item's requester, logged by a member.
export async function createTeamFeedbackAttachment(
  user: AuthUser,
  body: { issueId?: unknown; requesterId?: unknown },
): Promise<{ attachmentId: string }> {
  const issueId = requireId(body.issueId, 'issueId');
  const requesterId = requireId(body.requesterId, 'requesterId');
  await assertFeedbackWrite(issueId, user);
  return createRequesterAttachment(issueId, requesterId, 'team', user.id);
}

// The people whose first active feedback on issues the user can see is at or after
// `since`, with that date: the dashboards' "new people". One query; no names or emails.
export async function firstRequestsSince(
  userId: string,
  query: { since?: unknown },
): Promise<{ people: { id: string; firstFeedbackAt: string }[] }> {
  await assertMember(userId);
  const since = typeof query.since === 'string' ? new Date(query.since) : null;
  if (!since || Number.isNaN(since.getTime()))
    throw new HttpError(400, 'since must be a date and time');
  const first = sql<Date>`min(${customerNeed.createdAt})`;
  const rows = await db
    .select({ id: attachment.externalUserCreatorId, first })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .innerJoin(issue, eq(issue.id, customerNeed.issueId))
    .where(
      and(
        isNull(customerNeed.archivedAt),
        sql`${attachment.externalUserCreatorId} IS NOT NULL`,
        inArray(issue.teamId, visibleTeamIds(userId)),
      ),
    )
    .groupBy(attachment.externalUserCreatorId)
    .having(sql`${first} >= ${since.toISOString()}`);
  return {
    people: rows.flatMap((r) =>
      r.id ? [{ id: r.id, firstFeedbackAt: iso(new Date(r.first)) }] : [],
    ),
  };
}

// The number of people asking on an issue (distinct requesters of its active feedback;
// a merge points the feedback at the person kept), for anyone who can see the issue,
// guests included. Guests read no feedback through GraphQL, and Linear's schema has no
// per-issue count they could read, so the web asks here. Only the number is returned.
export async function feedbackPeopleCount(
  userId: string,
  query: { issueId?: unknown },
): Promise<{ people: number }> {
  const issueId = requireId(query.issueId, 'issueId');
  const [row] = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));
  if (!row || !(await canSeeTeam(row.teamId, userId))) throw new HttpError(404, 'Issue not found');
  const [count] = await db
    .select({ people: sql<number>`count(DISTINCT ${attachment.externalUserCreatorId})::int` })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .where(
      and(
        eq(customerNeed.issueId, issueId),
        isNull(customerNeed.archivedAt),
        sql`${attachment.externalUserCreatorId} IS NOT NULL`,
      ),
    );
  return { people: count?.people ?? 0 };
}

// A member turning a person's email updates on or off ("Keep this person updated").
// Refused (409) when turning on for a person who unsubscribed.
export async function setRequesterUpdates(
  userId: string,
  body: { requesterId?: unknown; enabled?: unknown },
): Promise<RequesterDto> {
  await assertMember(userId);
  const row = await resolveRequester(requireId(body.requesterId, 'requesterId'));
  if (!row) throw new HttpError(404, 'Requester not found');
  await setPrefs(row.id, parsePatch({ enabled: body.enabled }, 'team'), 'team');
  const [updated] = await db.select().from(externalUser).where(eq(externalUser.id, row.id));
  return dtoOf(userId, updated!);
}

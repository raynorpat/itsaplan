import { attachment, customerNeed, db, externalUser, issue, team, workflowState } from '@repo/db';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { atLeast, visibleTeamIds, workspaceRole, type AuthUser } from '../shared/access';
import { HttpError, iso, UUID_RE } from '../shared/lib';
import { assertFeedbackWrite, readsFeedback } from './access';
import { createRequesterAttachment } from './store';

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

// The requester a row now stands for: itself, or the one it was merged into.
async function resolveRequester(id: string) {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const [row] = await db.select().from(externalUser).where(eq(externalUser.id, current));
    if (!row) return null;
    if (!row.mergedIntoId) return row;
    current = row.mergedIntoId;
  }
  return null;
}

// The active requester an email leads to: its owner, or (for a merged requester's
// email) the one it was merged into.
async function requesterByEmail(email: string) {
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

// Feedback counts per requester, over feedback on issues the user can see.
async function feedbackStats(
  userId: string,
  ids: string[],
): Promise<Map<string, { count: number; last: string | null }>> {
  const out = new Map<string, { count: number; last: string | null }>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      requesterId: attachment.externalUserCreatorId,
      count: sql<number>`count(*)::int`,
      last: sql<Date | null>`max(${customerNeed.createdAt})`,
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
      out.set(r.requesterId, { count: r.count, last: r.last ? iso(new Date(r.last)) : null });
  return out;
}

function toDto(
  row: typeof externalUser.$inferSelect,
  stats: { count: number; last: string | null } | undefined,
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
  feedback: { id: string; body: string | null; priority: number; createdAt: string }[];
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
    const [updated] = await db
      .update(externalUser)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(externalUser.id, row.id))
      .returning();
    // The feedback attachments show the requester's name as their title.
    if (patch.displayName)
      await db
        .update(attachment)
        .set({ title: patch.displayName })
        .where(eq(attachment.externalUserCreatorId, row.id));
    return dtoOf(userId, updated!);
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
  const kept = await db.transaction(async (tx) => {
    await tx
      .update(attachment)
      .set({ externalUserCreatorId: into.id, title: into.displayName })
      .where(eq(attachment.externalUserCreatorId, from.id));
    const takeEmail = !into.email && from.email;
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
      .set({ ...(takeEmail ? { email: from.email } : {}), updatedAt: sql`now()` })
      .where(eq(externalUser.id, into.id))
      .returning();
    return row!;
  });
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

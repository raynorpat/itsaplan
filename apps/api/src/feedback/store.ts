import { attachment, customerNeed, db, externalUser, issue, user } from '@repo/db';
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  createFeedbackAttachment,
  deleteAttachment,
  getAttachment,
  moveAttachment,
} from '../attachments/store';
import { HttpError, iso } from '../shared/lib';
import { shownName } from '../shared/user-name';
import { emitEvent, isWatched, type WebhookAction } from '../webhooks/event';
import { customerNeedData, type WebhookData } from '../webhooks/data';

// Feedback on issues (Linear's CustomerNeed). The requester (Linear's ExternalUser) is
// the external creator of the feedback's source attachment; `body` is the quote and
// `priority` 1 marks it important. Every write goes through this module, which sends
// the CustomerNeed webhooks. Feedback notifies no one and runs no automation: it never
// changes the issue itself.

export interface NeedRow {
  id: string;
  issueId: string;
  attachmentId: string | null;
  body: string | null;
  priority: number;
  creatorId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapNeed(row: typeof customerNeed.$inferSelect): NeedRow {
  return {
    id: row.id,
    issueId: row.issueId,
    attachmentId: row.attachmentId,
    body: row.body,
    priority: row.priority,
    creatorId: row.creatorId,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function getNeed(id: string): Promise<NeedRow | null> {
  const [row] = await db.select().from(customerNeed).where(eq(customerNeed.id, id));
  return row ? mapNeed(row) : null;
}

async function teamOf(issueId: string): Promise<string | null> {
  const [row] = await db.select({ teamId: issue.teamId }).from(issue).where(eq(issue.id, issueId));
  return row?.teamId ?? null;
}

async function sendNeedEvent(
  action: WebhookAction,
  row: NeedRow,
  actorUserId: string | null,
  extra: { teamIds?: string[]; before?: WebhookData } = {},
): Promise<void> {
  const own = await teamOf(row.issueId);
  const teamIds = [...new Set([...(own ? [own] : []), ...(extra.teamIds ?? [])])];
  if (!(await isWatched('CustomerNeed', teamIds))) return;
  await emitEvent({
    type: 'CustomerNeed',
    action,
    teamIds,
    actorUserId,
    data: customerNeedData(row),
    before: extra.before,
  });
}

const SOURCE_SUBTITLE = { portal: 'Portal', form: 'Form' } as const;

// The requester a merged requester now points at (merges never chain further than
// the row they name, but follow a few steps in case).
async function activeRequester(id: string) {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const [row] = await db.select().from(externalUser).where(eq(externalUser.id, current));
    if (!row) return null;
    if (!row.mergedIntoId) return row;
    current = row.mergedIntoId;
  }
  return null;
}

// Creates the source attachment that names a feedback item's requester, on the issue.
// The caller checks the actor may add feedback there. `source` is where the feedback
// came from: logged by a member, or (later) the portal or a form.
export async function createRequesterAttachment(
  issueId: string,
  requesterId: string,
  source: 'team' | 'portal' | 'form',
  actorId: string | null,
): Promise<{ attachmentId: string }> {
  const requester = await activeRequester(requesterId);
  if (!requester) throw new HttpError(404, 'Requester not found');
  if (!(await teamOf(issueId))) throw new HttpError(404, 'Issue not found');
  let subtitle: string;
  if (source === 'team') {
    const [actor] = actorId
      ? await db
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, actorId))
      : [];
    subtitle = actor ? `Logged by ${shownName(actor)}` : 'Logged by the team';
  } else subtitle = SOURCE_SUBTITLE[source];
  const created = await createFeedbackAttachment({
    issueId,
    externalUserCreatorId: requester.id,
    title: requester.displayName,
    subtitle,
    creatorUserId: actorId,
  });
  return { attachmentId: created.id };
}

export interface NeedInput {
  id?: string;
  issueId: string;
  attachmentId?: string | null;
  body?: string | null;
  priority?: number;
  creatorId: string | null;
  createdAt?: Date;
}

function checkPriority(priority: number | undefined): void {
  if (priority !== undefined && priority !== 0 && priority !== 1)
    throw new HttpError(400, 'priority must be 0 or 1');
}

// Linear's customerNeedCreate on an issue. A source attachment must be on the same
// issue and not already the source of another feedback item.
export async function createNeed(input: NeedInput): Promise<NeedRow> {
  checkPriority(input.priority);
  if (input.createdAt && input.createdAt.getTime() > Date.now())
    throw new HttpError(400, 'createdAt must be in the past');
  if (input.attachmentId) {
    const source = await getAttachment(input.attachmentId);
    if (!source || source.issueId !== input.issueId)
      throw new HttpError(400, 'attachmentId must name an attachment on the issue');
  }
  let row;
  try {
    [row] = await db
      .insert(customerNeed)
      .values({
        ...(input.id ? { id: input.id } : {}),
        issueId: input.issueId,
        attachmentId: input.attachmentId ?? null,
        body: input.body ?? null,
        priority: input.priority ?? 0,
        creatorId: input.creatorId,
        ...(input.createdAt ? { createdAt: input.createdAt, updatedAt: input.createdAt } : {}),
      })
      .returning();
  } catch (err) {
    const code =
      (err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code;
    if (code === '23505')
      throw new HttpError(409, 'The attachment or id is already used by another feedback item');
    throw err;
  }
  const created = mapNeed(row!);
  await sendNeedEvent('create', created, input.creatorId);
  return created;
}

// Linear's customerNeedUpdate: the quote, importance, or the issue (its source
// attachment moves with it). The caller checks access to both issues.
export async function updateNeed(
  id: string,
  patch: { body?: string | null; priority?: number; issueId?: string },
  actorId: string | null,
): Promise<NeedRow> {
  checkPriority(patch.priority);
  const current = await getNeed(id);
  if (!current) throw new HttpError(404, 'Feedback not found');
  const moving = patch.issueId !== undefined && patch.issueId !== current.issueId;
  const [row] = await db
    .update(customerNeed)
    .set({
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(moving ? { issueId: patch.issueId } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(customerNeed.id, id))
    .returning();
  if (!row) throw new HttpError(404, 'Feedback not found');
  if (moving && current.attachmentId)
    await moveAttachment(current.attachmentId, patch.issueId!, actorId);
  const updated = mapNeed(row);
  const oldTeam = moving ? await teamOf(current.issueId) : null;
  await sendNeedEvent('update', updated, actorId, {
    teamIds: oldTeam ? [oldTeam] : [],
    before: customerNeedData(current),
  });
  return updated;
}

export async function setNeedArchived(
  id: string,
  archived: boolean,
  actorId: string | null,
): Promise<NeedRow> {
  const current = await getNeed(id);
  if (!current) throw new HttpError(404, 'Feedback not found');
  const [row] = await db
    .update(customerNeed)
    .set({ archivedAt: archived ? sql`now()` : null, updatedAt: sql`now()` })
    .where(eq(customerNeed.id, id))
    .returning();
  const updated = mapNeed(row!);
  await sendNeedEvent('update', updated, actorId, { before: customerNeedData(current) });
  return updated;
}

// Linear's customerNeedDelete: removes the feedback and, unless kept, its source
// attachment.
export async function deleteNeed(
  id: string,
  keepAttachment: boolean,
  actorId: string | null,
): Promise<NeedRow> {
  const [row] = await db.delete(customerNeed).where(eq(customerNeed.id, id)).returning();
  if (!row) throw new HttpError(404, 'Feedback not found');
  const deleted = mapNeed(row);
  if (!keepAttachment && deleted.attachmentId)
    await deleteAttachment(deleted.attachmentId, actorId);
  await sendNeedEvent('remove', deleted, actorId);
  return deleted;
}

// The people asking on an issue, correlated with the outer `issue` row: distinct
// requesters of its active feedback (feedback without a requester is not a person).
// With `importantOnly`, those with important feedback. Linear's customerCount and
// customerImportantCount, counted per requester while Customers are off.
export function requesterCountSql(importantOnly = false): SQL<number> {
  return sql<number>`(
    SELECT count(DISTINCT ${attachment.externalUserCreatorId})::int
    FROM ${customerNeed}
    JOIN ${attachment} ON ${attachment.id} = ${customerNeed.attachmentId}
    WHERE ${customerNeed.issueId} = ${issue.id}
      AND ${customerNeed.archivedAt} IS NULL
      AND ${attachment.externalUserCreatorId} IS NOT NULL
      ${importantOnly ? sql`AND ${customerNeed.priority} = 1` : sql``}
  )`;
}

// The same counts for a set of issues, for callers that read them in bulk.
export async function requesterCounts(
  issueIds: string[],
): Promise<Map<string, { requesters: number; important: number }>> {
  const out = new Map<string, { requesters: number; important: number }>();
  for (const id of issueIds) out.set(id, { requesters: 0, important: 0 });
  if (issueIds.length === 0) return out;
  const rows = await db
    .select({
      issueId: customerNeed.issueId,
      requesters: sql<number>`count(DISTINCT ${attachment.externalUserCreatorId})::int`,
      important: sql<number>`count(DISTINCT ${attachment.externalUserCreatorId}) FILTER (WHERE ${customerNeed.priority} = 1)::int`,
    })
    .from(customerNeed)
    .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
    .where(
      and(
        inArray(customerNeed.issueId, issueIds),
        isNull(customerNeed.archivedAt),
        isNotNull(attachment.externalUserCreatorId),
      ),
    )
    .groupBy(customerNeed.issueId);
  for (const r of rows) out.set(r.issueId, { requesters: r.requesters, important: r.important });
  return out;
}

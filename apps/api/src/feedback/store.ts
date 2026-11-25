import {
  attachment,
  customer,
  customerNeed,
  db,
  externalUser,
  issue,
  organization,
  user,
} from '@repo/db';
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  announceAttachment,
  announceAttachmentMove,
  createFeedbackAttachment,
  feedbackAttachmentValues,
  mapAttachment,
  deleteAttachment,
  getAttachment,
  moveAttachmentRow,
} from '../attachments/store';
import { assertCustomersEnabled } from '../customers/settings';
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
  // The customer: the requester's, or the one given for feedback without a requester.
  customerId: string | null;
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
    customerId: row.customerId,
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

type RequesterRow = typeof externalUser.$inferSelect;

// The requester a row now stands for: itself, or the one it was merged into. A merge
// re-points earlier merges, so the chain is one step; a few steps are followed in
// case, and a loop answers null. `load` reads one row (directly or through a
// request loader).
export async function followMerges(
  id: string,
  load: (id: string) => Promise<RequesterRow | null | undefined>,
): Promise<RequesterRow | null> {
  let current = id;
  for (let i = 0; i < 5; i++) {
    const row = await load(current);
    if (!row) return null;
    if (!row.mergedIntoId) return row;
    current = row.mergedIntoId;
  }
  return null;
}

async function loadRequester(id: string): Promise<RequesterRow | null> {
  const [row] = await db.select().from(externalUser).where(eq(externalUser.id, id));
  return row ?? null;
}

export const activeRequester = (id: string) => followMerges(id, loadRequester);

// Creates the source attachment that names a feedback item's requester, on the issue.
// The caller checks the actor may add feedback there. `source` is where the feedback
// came from: logged by a member, the portal or a form.
export async function createRequesterAttachment(
  issueId: string,
  requesterId: string,
  source: 'team' | 'portal' | 'form',
  actorId: string | null,
  // A form's name: its feedback reads "Form: <name>".
  formName?: string,
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
  } else if (source === 'form' && formName) subtitle = `Form: ${formName}`;
  else subtitle = SOURCE_SUBTITLE[source];
  const created = await createFeedbackAttachment({
    issueId,
    externalUserCreatorId: requester.id,
    title: requester.displayName,
    subtitle,
    creatorUserId: actorId,
    source,
  });
  return { attachmentId: created.id };
}

// --- Portal votes ------------------------------------------------------------------

// A portal vote is feedback with a portal source attachment and no quote. Each vote
// change runs in one transaction that takes a lock for the person and issue (two votes
// at once make one item) and does every read and write on that transaction's
// connection: waiting for another pool connection while holding one would let a burst
// of votes take the whole pool and wait on each other. Events go out after the commit.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lockVote = (tx: Tx, issueId: string, requesterId: string) =>
  tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`portal-vote:${requesterId}:${issueId}`}))`,
  );

// Adds the requester's portal vote unless they already have active feedback on the
// issue. The caller checks the requester may vote there.
export async function addPortalVote(issueId: string, requesterId: string): Promise<void> {
  const requester = await activeRequester(requesterId);
  if (!requester) throw new HttpError(404, 'Requester not found');
  const values = feedbackAttachmentValues({
    issueId,
    externalUserCreatorId: requester.id,
    title: requester.displayName,
    subtitle: SOURCE_SUBTITLE.portal,
    creatorUserId: null,
    source: 'portal',
  });
  const created = await db.transaction(async (tx) => {
    await lockVote(tx, issueId, requester.id);
    const [existing] = await tx
      .select({ id: customerNeed.id })
      .from(customerNeed)
      .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
      .where(
        and(
          eq(customerNeed.issueId, issueId),
          isNull(customerNeed.archivedAt),
          eq(attachment.externalUserCreatorId, requester.id),
        ),
      )
      .limit(1);
    if (existing) return null;
    const [source] = await tx.insert(attachment).values(values).returning();
    const [need] = await tx
      .insert(customerNeed)
      .values({
        issueId,
        attachmentId: source!.id,
        body: null,
        creatorId: null,
        customerId: requester.customerId,
      })
      .returning();
    return { source: mapAttachment(source!), need: mapNeed(need!) };
  });
  if (!created) return;
  await announceAttachment('create', created.source, null);
  await sendNeedEvent('create', created.need, null);
}

// Removes the requester's portal votes on the issue (feedback the team logged stays).
export async function removePortalVotes(issueId: string, requesterId: string): Promise<void> {
  const removed = await db.transaction(async (tx) => {
    await lockVote(tx, issueId, requesterId);
    const votes = await tx
      .select({ id: customerNeed.id })
      .from(customerNeed)
      .innerJoin(attachment, eq(attachment.id, customerNeed.attachmentId))
      .where(
        and(
          eq(customerNeed.issueId, issueId),
          isNull(customerNeed.body),
          eq(attachment.externalUserCreatorId, requesterId),
          sql`${attachment.metadata}->>'source' = 'portal'`,
        ),
      );
    if (votes.length === 0) return null;
    const needs = await tx
      .delete(customerNeed)
      .where(
        inArray(
          customerNeed.id,
          votes.map((v) => v.id),
        ),
      )
      .returning();
    const sourceIds = needs.flatMap((n) => (n.attachmentId ? [n.attachmentId] : []));
    const sources = sourceIds.length
      ? await tx.delete(attachment).where(inArray(attachment.id, sourceIds)).returning()
      : [];
    return { needs: needs.map(mapNeed), sources: sources.map(mapAttachment) };
  });
  if (!removed) return;
  for (const source of removed.sources) await announceAttachment('remove', source, null);
  for (const need of removed.needs) await sendNeedEvent('remove', need, null);
}

export interface NeedInput {
  id?: string;
  issueId: string;
  attachmentId?: string | null;
  body?: string | null;
  priority?: number;
  creatorId: string | null;
  createdAt?: Date;
  // Omitted: the requester's customer, or none. Given for feedback with a requester, it
  // must be the requester's customer.
  customerId?: string | null;
}

// Linear caps long text inputs; a quote longer than this is refused.
export const MAX_FEEDBACK_BODY = 10_000;

function checkPriority(priority: number | undefined): void {
  if (priority !== undefined && priority !== 0 && priority !== 1)
    throw new HttpError(400, 'priority must be 0 or 1');
}

function checkBody(body: string | null | undefined): void {
  if (body != null && body.length > MAX_FEEDBACK_BODY)
    throw new HttpError(400, `body must be at most ${MAX_FEEDBACK_BODY} characters`);
}

// The customer of the person who gave the feedback in `attachmentId`, or undefined when
// the attachment names no person.
async function requesterCustomer(attachmentId: string | null): Promise<string | null | undefined> {
  if (!attachmentId) return undefined;
  const [row] = await db
    .select({ personId: externalUser.id, customerId: externalUser.customerId })
    .from(attachment)
    .innerJoin(externalUser, eq(externalUser.id, attachment.externalUserCreatorId))
    .where(eq(attachment.id, attachmentId));
  return row ? row.customerId : undefined;
}

// The customer a feedback item gets: a requester's customer always wins (a different
// `given` one is refused); without a requester, the `given` customer, which must exist.
async function needCustomer(
  attachmentId: string | null,
  given: string | null | undefined,
): Promise<string | null | undefined> {
  const ofRequester = await requesterCustomer(attachmentId);
  if (ofRequester !== undefined) {
    if (given !== undefined && given !== ofRequester)
      throw new HttpError(400, 'The customer of a request follows its requester');
    return ofRequester;
  }
  if (given) {
    await assertCustomersEnabled();
    const [found] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.id, given));
    if (!found) throw new HttpError(404, 'Customer not found');
  }
  return given;
}

// Linear's customerNeedCreate on an issue. A source attachment must be on the same
// issue and not already the source of another feedback item.
export async function createNeed(input: NeedInput): Promise<NeedRow> {
  checkPriority(input.priority);
  checkBody(input.body);
  if (input.createdAt && input.createdAt.getTime() > Date.now())
    throw new HttpError(400, 'createdAt must be in the past');
  if (input.attachmentId) {
    const source = await getAttachment(input.attachmentId);
    if (!source || source.issueId !== input.issueId)
      throw new HttpError(400, 'attachmentId must name an attachment on the issue');
  }
  const customerId = (await needCustomer(input.attachmentId ?? null, input.customerId)) ?? null;
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
        customerId,
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
  patch: { body?: string | null; priority?: number; issueId?: string; customerId?: string | null },
  actorId: string | null,
): Promise<NeedRow> {
  checkPriority(patch.priority);
  checkBody(patch.body);
  const current = await getNeed(id);
  if (!current) throw new HttpError(404, 'Feedback not found');
  const customerId =
    patch.customerId === undefined
      ? undefined
      : await needCustomer(current.attachmentId, patch.customerId);
  const moving = patch.issueId !== undefined && patch.issueId !== current.issueId;
  // The feedback and its source attachment move together or not at all.
  const { row, attachmentMove } = await db.transaction(async (tx) => {
    const [updatedRow] = await tx
      .update(customerNeed)
      .set({
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(moving ? { issueId: patch.issueId } : {}),
        ...(customerId !== undefined ? { customerId } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(customerNeed.id, id))
      .returning();
    if (!updatedRow) throw new HttpError(404, 'Feedback not found');
    const move =
      moving && current.attachmentId
        ? await moveAttachmentRow(tx, current.attachmentId, patch.issueId!)
        : null;
    return { row: updatedRow, attachmentMove: move };
  });
  if (attachmentMove) await announceAttachmentMove(attachmentMove, actorId);
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
// customerImportantCount while Customers is off (customerCountSql), and the portal's
// vote count.
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

// Whether Customers is on, as SQL, so a count or filter built without awaiting reads it
// in the same statement.
export const customersOnSql = sql<boolean>`COALESCE((SELECT ${organization.customersEnabled} FROM ${organization} LIMIT 1), false)`;

// Linear's customerCount and customerImportantCount, correlated with the outer `issue`
// row. While Customers is on: the distinct customers of the issue's active feedback,
// each person without a customer once, and each feedback item with neither once
// (Linear: "Requests without a customer record each count separately"). While off: the
// people asking (requesterCountSql).
export function customerCountSql(importantOnly = false): SQL<number> {
  return sql<number>`(CASE WHEN ${customersOnSql} THEN (
    SELECT count(DISTINCT COALESCE(
      'c:' || ${customerNeed.customerId}::text,
      'p:' || ${attachment.externalUserCreatorId}::text,
      'n:' || ${customerNeed.id}::text))::int
    FROM ${customerNeed}
    LEFT JOIN ${attachment} ON ${attachment.id} = ${customerNeed.attachmentId}
    WHERE ${customerNeed.issueId} = ${issue.id}
      AND ${customerNeed.archivedAt} IS NULL
      ${importantOnly ? sql`AND ${customerNeed.priority} = 1` : sql``}
  ) ELSE ${requesterCountSql(importantOnly)} END)`;
}

// The feedback on an issue, read before the issue is deleted (its feedback goes with
// it), and the remove events sent once the delete has committed.
export async function needsOnIssue(issueId: string): Promise<NeedRow[]> {
  const rows = await db.select().from(customerNeed).where(eq(customerNeed.issueId, issueId));
  return rows.map(mapNeed);
}

export async function announceNeedsRemoved(
  rows: NeedRow[],
  teamId: string,
  actorId: string | null,
): Promise<void> {
  for (const row of rows) await sendNeedEvent('remove', row, actorId, { teamIds: [teamId] });
}

// The feedback item whose source is `attachmentId`, if any.
export async function needOfAttachment(attachmentId: string): Promise<NeedRow | null> {
  const [row] = await db
    .select()
    .from(customerNeed)
    .where(eq(customerNeed.attachmentId, attachmentId));
  return row ? mapNeed(row) : null;
}

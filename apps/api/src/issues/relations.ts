import { withoutWorkflows } from '../shared/workflow-context';
import { db, issue, issueRelation, team, workflowState } from '@repo/db';
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { HttpError, iso, pgErrorCode } from '../shared/lib';
import { recordActivity, type ActivityExecutor } from './activity';
import { updateIssue } from './store';

// Issue relations (Linear's IssueRelation). blocks: the issue blocks the related
// issue; duplicate: the issue is a duplicate of the related issue; related:
// symmetric. One relation per unordered pair; relations may cross teams. A change
// and its history on both issues are written in one transaction; closing a
// duplicate is a separate issue update (its own history entry and webhook).
// Callers check access.

export type IssueRelationType = 'blocks' | 'duplicate' | 'related';
const TYPES: IssueRelationType[] = ['blocks', 'duplicate', 'related'];

export interface IssueRelationRow {
  id: string;
  issueId: string;
  relatedIssueId: string;
  type: IssueRelationType;
  createdAt: string;
  updatedAt: string;
}

export function mapIssueRelation(row: typeof issueRelation.$inferSelect): IssueRelationRow {
  return {
    id: row.id,
    issueId: row.issueId,
    relatedIssueId: row.relatedIssueId,
    type: row.type as IssueRelationType,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function getIssueRelation(id: string): Promise<IssueRelationRow | null> {
  const [row] = await db.select().from(issueRelation).where(eq(issueRelation.id, id));
  return row ? mapIssueRelation(row) : null;
}

function checkType(type: string): IssueRelationType {
  if (!TYPES.includes(type as IssueRelationType))
    throw new HttpError(400, `Relation type ${type} is not supported`);
  return type as IssueRelationType;
}

// Rejects a self relation and a second relation between the same pair (in either
// direction); `exceptId` is the relation being changed.
async function checkPair(issueId: string, relatedIssueId: string, exceptId?: string) {
  if (issueId === relatedIssueId) throw new HttpError(400, 'An issue cannot be related to itself');
  const [existing] = await db
    .select({ id: issueRelation.id })
    .from(issueRelation)
    .where(
      and(
        or(
          and(eq(issueRelation.issueId, issueId), eq(issueRelation.relatedIssueId, relatedIssueId)),
          and(eq(issueRelation.issueId, relatedIssueId), eq(issueRelation.relatedIssueId, issueId)),
        ),
        exceptId ? ne(issueRelation.id, exceptId) : undefined,
      ),
    );
  if (existing) throw new HttpError(400, 'These issues are already related');
}

// Written instead of the other issue's identifier when the two issues are in
// different teams: the history of one issue is shown to every member of its team,
// who may not be allowed to see the other team.
const OTHER_TEAM_ISSUE = 'an issue in another team';

async function issueTeamAndIdentifier(issueId: string) {
  const [row] = await db
    .select({ teamId: issue.teamId, key: team.key, seq: issue.sequenceNumber })
    .from(issue)
    .innerJoin(team, eq(team.id, issue.teamId))
    .where(eq(issue.id, issueId));
  return row ? { teamId: row.teamId, identifier: `${row.key}-${row.seq}` } : null;
}

// The relation as seen from each side, for the history subject.
const SUBJECTS: Record<IssueRelationType, [string, string]> = {
  blocks: ['blocks', 'blocked_by'],
  duplicate: ['duplicate_of', 'duplicated_by'],
  related: ['related', 'related'],
};

// Logs the relation on both issues: added (toText) or removed (fromText).
async function logRelation(
  r: Pick<IssueRelationRow, 'issueId' | 'relatedIssueId' | 'type'>,
  change: 'added' | 'removed',
  actorUserId: string | null,
  executor?: ActivityExecutor,
): Promise<void> {
  const [fromSide, toSide] = SUBJECTS[r.type];
  const sides = [
    { issueId: r.issueId, other: r.relatedIssueId, subject: fromSide },
    { issueId: r.relatedIssueId, other: r.issueId, subject: toSide },
  ];
  for (const side of sides) {
    const [own, otherIssue] = await Promise.all([
      issueTeamAndIdentifier(side.issueId),
      issueTeamAndIdentifier(side.other),
    ]);
    const other =
      otherIssue && own?.teamId === otherIssue.teamId ? otherIssue.identifier : OTHER_TEAM_ISSUE;
    await recordActivity(
      side.issueId,
      [
        {
          action: 'relation',
          subject: side.subject,
          fromText: change === 'removed' ? other : null,
          toText: change === 'added' ? other : null,
          fromId: change === 'removed' ? side.other : null,
          toId: change === 'added' ? side.other : null,
        },
      ],
      actorUserId,
      executor,
    );
  }
}

// Linear closes a duplicate: the issue moves to its team's canceled state named
// "Duplicate", else the first canceled state, unless it is already completed or
// canceled.
async function closeDuplicate(issueId: string, actorUserId: string | null): Promise<void> {
  const [row] = await db
    .select({ teamId: issue.teamId, stateType: workflowState.stateType })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(eq(issue.id, issueId));
  if (!row || row.stateType === 'completed' || row.stateType === 'canceled') return;
  const [target] = await db
    .select({ id: workflowState.id })
    .from(workflowState)
    .where(
      and(
        eq(workflowState.teamId, row.teamId),
        eq(workflowState.stateType, 'canceled'),
        isNull(workflowState.archivedAt),
      ),
    )
    .orderBy(sql`lower(${workflowState.name}) <> 'duplicate'`, asc(workflowState.position))
    .limit(1);
  // A system change: it runs no automation rules.
  if (target)
    await withoutWorkflows(() => updateIssue(issueId, { stateId: target.id }, actorUserId));
}

// A unique violation is the pair index (a concurrent relation between the same
// issues); a foreign key violation is an issue deleted since the access check.
const rethrowPair = (err: unknown): never => {
  if (pgErrorCode(err) === '23505') throw new HttpError(400, 'These issues are already related');
  if (pgErrorCode(err) === '23503') throw new HttpError(404, 'Issue not found');
  throw err;
};

export async function createIssueRelation(
  input: { issueId: string; relatedIssueId: string; type: string; id?: string },
  actorUserId: string,
): Promise<IssueRelationRow> {
  const type = checkType(input.type);
  if (input.id && (await getIssueRelation(input.id)))
    throw new HttpError(409, 'An issue relation with this id already exists');
  await checkPair(input.issueId, input.relatedIssueId);
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(issueRelation)
      .values({
        ...(input.id ? { id: input.id } : {}),
        issueId: input.issueId,
        relatedIssueId: input.relatedIssueId,
        type,
      })
      .returning()
      .catch(rethrowPair);
    const inserted = mapIssueRelation(row!);
    await logRelation(inserted, 'added', actorUserId, tx);
    return inserted;
  });
  if (type === 'duplicate') await closeDuplicate(created.issueId, actorUserId);
  return created;
}

// A change is logged as the old relation removed and the new one added.
export async function updateIssueRelation(
  id: string,
  patch: { issueId?: string; relatedIssueId?: string; type?: string },
  actorUserId: string,
): Promise<IssueRelationRow> {
  const current = await getIssueRelation(id);
  if (!current) throw new HttpError(404, 'Issue relation not found');
  const next = {
    issueId: patch.issueId ?? current.issueId,
    relatedIssueId: patch.relatedIssueId ?? current.relatedIssueId,
    type: patch.type !== undefined ? checkType(patch.type) : current.type,
  };
  await checkPair(next.issueId, next.relatedIssueId, id);
  const changed =
    next.issueId !== current.issueId ||
    next.relatedIssueId !== current.relatedIssueId ||
    next.type !== current.type;
  if (!changed) return current;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(issueRelation)
      .set({ ...next, updatedAt: new Date() })
      .where(eq(issueRelation.id, id))
      .returning()
      .catch(rethrowPair);
    if (!row) throw new HttpError(404, 'Issue relation not found');
    const saved = mapIssueRelation(row);
    await logRelation(current, 'removed', actorUserId, tx);
    await logRelation(saved, 'added', actorUserId, tx);
    return saved;
  });
  if (updated.type === 'duplicate') await closeDuplicate(updated.issueId, actorUserId);
  return updated;
}

export async function deleteIssueRelation(id: string, actorUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(issueRelation).where(eq(issueRelation.id, id)).returning();
    if (!row) throw new HttpError(404, 'Issue relation not found');
    await logRelation(mapIssueRelation(row), 'removed', actorUserId, tx);
  });
}

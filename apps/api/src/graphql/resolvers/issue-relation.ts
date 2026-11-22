import { db, issue, issueRelation } from '@repo/db';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import {
  createIssueRelation,
  deleteIssueRelation,
  getIssueRelation,
  mapIssueRelation,
  updateIssueRelation,
  type IssueRelationRow,
} from '../../issues/relations';
import { assertPermission } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { findIssue, issueById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { visibleTeamIds } from './team';

// Linear's IssueRelation. A relation is visible when both issues are visible
// (team members); writes need work_items.edit in the team of either issue.

const toRelation = (r: IssueRelationRow) => ({ ...r, archivedAt: null });

// Subquery of the ids of the issues the viewer can see.
const visibleIssues = (viewerId: string) =>
  db
    .select({ id: issue.id })
    .from(issue)
    .where(inArray(issue.teamId, visibleTeamIds(viewerId)));

function listRelations(where: SQL | undefined, args: PageArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    {
      id: issueRelation.id,
      createdAt: issueRelation.createdAt,
      updatedAt: issueRelation.updatedAt,
    },
    and(
      inArray(issueRelation.issueId, visibleIssues(ctx.user.id)),
      inArray(issueRelation.relatedIssueId, visibleIssues(ctx.user.id)),
      where,
    ),
    (w, order, limit) =>
      db
        .select()
        .from(issueRelation)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toRelation(mapIssueRelation(row)),
  );
}

// A relation whose issues are both visible, or ENTITY_NOT_FOUND.
async function findRelation(id: string, ctx: GraphQLContext): Promise<IssueRelationRow> {
  const found = UUID_RE.test(id) ? await getIssueRelation(id) : null;
  if (!found) throw gqlError('ENTITY_NOT_FOUND', `Issue relation ${id} not found`);
  await findIssue(found.issueId, ctx.user.id);
  await findIssue(found.relatedIssueId, ctx.user.id);
  return found;
}

// Both issues visible (ENTITY_NOT_FOUND) and work_items.edit in the team of
// either (FORBIDDEN). Returns the issues' ids.
async function assertCanRelate(issueId: string, relatedIssueId: string, ctx: GraphQLContext) {
  const a = await findIssue(issueId, ctx.user.id);
  const b = await findIssue(relatedIssueId, ctx.user.id);
  for (const teamId of new Set([a.teamId, b.teamId])) {
    const granted = await assertPermission(teamId, ctx.user, 'work_items', 'edit').then(
      () => true,
      () => false,
    );
    if (granted) return { issueId: a.id, relatedIssueId: b.id };
  }
  throw new HttpError(403, 'You do not have permission to edit these issues');
}

const payload = (r: IssueRelationRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  issueRelation: toRelation(r),
});

export const issueRelationResolvers = {
  Query: {
    issueRelation: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toRelation(await findRelation(id, ctx))),
    issueRelations: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(undefined, args, ctx),
  },
  Issue: {
    relations: (i: { id: string }, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(eq(issueRelation.issueId, i.id), args, ctx),
    inverseRelations: (i: { id: string }, args: PageArgs, ctx: GraphQLContext) =>
      listRelations(eq(issueRelation.relatedIssueId, i.id), args, ctx),
  },
  IssueRelation: {
    issue: (r: IssueRelationRow) => issueById(r.issueId),
    relatedIssue: (r: IssueRelationRow) => issueById(r.relatedIssueId),
  },
  Mutation: {
    issueRelationCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['issueId', 'relatedIssueId', 'type', 'id'], 'input');
        if (input.id != null && !UUID_RE.test(String(input.id)))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        const ids = await assertCanRelate(String(input.issueId), String(input.relatedIssueId), ctx);
        const created = await createIssueRelation(
          { ...ids, type: String(input.type), id: input.id as string | undefined },
          ctx.user.id,
        );
        return payload(created);
      }),
    issueRelationUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['issueId', 'relatedIssueId', 'type'], 'input');
        const current = await findRelation(id, ctx);
        await assertCanRelate(current.issueId, current.relatedIssueId, ctx);
        const next = await assertCanRelate(
          (input.issueId as string | null | undefined) ?? current.issueId,
          (input.relatedIssueId as string | null | undefined) ?? current.relatedIssueId,
          ctx,
        );
        const updated = await updateIssueRelation(
          current.id,
          { ...next, type: (input.type as string | null | undefined) ?? undefined },
          ctx.user.id,
        );
        return payload(updated);
      }),
    issueRelationDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const current = await findRelation(id, ctx);
        await assertCanRelate(current.issueId, current.relatedIssueId, ctx);
        await deleteIssueRelation(current.id, ctx.user.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: current.id };
      }),
  },
};

import { db, team, workflowState } from '@repo/db';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql, type FieldHandlers } from '../filter';
import { teamFilter, toTeam, visibleTeamIds } from './team';
import { UUID_RE } from '../../shared/lib';

// Linear's WorkflowState is a team column; its team is the column's team.

type ColumnRecord = typeof workflowState.$inferSelect;

export function toWorkflowState(row: ColumnRecord) {
  return {
    id: row.id,
    name: row.name,
    type: row.stateType,
    color: row.color,
    description: row.description,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    // Read by WorkflowState.team; not a schema field.
    teamId: row.teamId,
  };
}

// WorkflowStateFilter fields this API supports, as SQL over the column table.
export const stateFilter: FieldHandlers = {
  id: (v, p) => compareId(workflowState.id, v, p),
  name: (v, p) => compare(workflowState.name, v, p),
  type: (v, p) => compare(workflowState.stateType, v, p),
  team: (v, p) =>
    inArray(
      workflowState.teamId,
      db
        .select({ id: team.id })
        .from(team)
        .where(filterSql(v, teamFilter, p)),
    ),
};

type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

// One page of workflow states matching `where`, the filter and includeArchived.
export function listStates(where: SQL | undefined, args: ConnectionArgs) {
  return paginate(
    args,
    {
      id: workflowState.id,
      createdAt: workflowState.createdAt,
      updatedAt: workflowState.createdAt,
    },
    and(
      where,
      args.includeArchived ? undefined : isNull(workflowState.archivedAt),
      filterSql(args.filter, stateFilter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(workflowState)
        .where(w)
        .orderBy(...order)
        .limit(limit)
        .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
    (row) => toWorkflowState(row),
  );
}

// A visible workflow state by id, archived or not, or ENTITY_NOT_FOUND.
export async function findState(id: string, userId: string): Promise<ColumnRecord> {
  const rows = UUID_RE.test(id)
    ? await db
        .select()
        .from(workflowState)
        .where(and(eq(workflowState.id, id), inArray(workflowState.teamId, visibleTeamIds(userId))))
    : [];
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Workflow state ${id} not found`);
  return rows[0];
}

export const workflowStateResolvers = {
  Query: {
    workflowStates: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listStates(inArray(workflowState.teamId, visibleTeamIds(ctx.user.id)), args),
    workflowState: async (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toWorkflowState(await findState(args.id, ctx.user.id)),
  },
  Team: {
    states: (team: { id: string }, args: ConnectionArgs) =>
      listStates(eq(workflowState.teamId, team.id), args),
  },
  WorkflowState: {
    team: async (state: { teamId: string }) => {
      const [row] = await db.select().from(team).where(eq(team.id, state.teamId));
      return toTeam(row!);
    },
  },
};

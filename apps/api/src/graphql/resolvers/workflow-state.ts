import { db, project, projectColumn } from '@repo/db';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql, type FieldHandlers } from '../filter';
import { teamFilter, toTeam, visibleProjectIds } from './team';

// Linear's WorkflowState is a project column; its team is the column's project.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ColumnRecord = typeof projectColumn.$inferSelect;

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
    projectId: row.projectId,
  };
}

const stateFilter: FieldHandlers = {
  id: (v, p) => compareId(projectColumn.id, v, p),
  name: (v, p) => compare(projectColumn.name, v, p),
  type: (v, p) => compare(projectColumn.stateType, v, p),
  team: (v, p) =>
    inArray(
      projectColumn.projectId,
      db
        .select({ id: project.id })
        .from(project)
        .where(filterSql(v, teamFilter, p)),
    ),
};

type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

// One page of workflow states matching `where`, the filter and includeArchived.
export function listStates(where: SQL | undefined, args: ConnectionArgs) {
  return paginate(
    args,
    {
      id: projectColumn.id,
      createdAt: projectColumn.createdAt,
      updatedAt: projectColumn.createdAt,
    },
    and(
      where,
      args.includeArchived ? undefined : isNull(projectColumn.archivedAt),
      filterSql(args.filter, stateFilter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(projectColumn)
        .where(w)
        .orderBy(...order)
        .limit(limit)
        .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
    (row) => toWorkflowState(row),
  );
}

// A visible workflow state by id, archived or not, or ENTITY_NOT_FOUND.
export async function findState(id: string, userId: string): Promise<ColumnRecord> {
  const rows = UUID.test(id)
    ? await db
        .select()
        .from(projectColumn)
        .where(
          and(
            eq(projectColumn.id, id),
            inArray(projectColumn.projectId, visibleProjectIds(userId)),
          ),
        )
    : [];
  if (!rows[0]) throw gqlError('ENTITY_NOT_FOUND', `Workflow state ${id} not found`);
  return rows[0];
}

export const workflowStateResolvers = {
  Query: {
    workflowStates: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listStates(inArray(projectColumn.projectId, visibleProjectIds(ctx.user.id)), args),
    workflowState: async (_: unknown, args: { id: string }, ctx: GraphQLContext) =>
      toWorkflowState(await findState(args.id, ctx.user.id)),
  },
  Team: {
    states: (team: { id: string }, args: ConnectionArgs) =>
      listStates(eq(projectColumn.projectId, team.id), args),
  },
  WorkflowState: {
    team: async (state: { projectId: string }) => {
      const [row] = await db.select().from(project).where(eq(project.id, state.projectId));
      return toTeam(row!);
    },
  },
};

import {
  db,
  issue,
  project,
  projectLabel,
  projectMilestone,
  projectStatus,
  projectUpdate,
  team,
} from '@repo/db';
import { trustedOrigins } from '@repo/auth';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql } from '../filter';
import { projectFilterSql } from '../project-filter';
import { UUID_RE } from '../../shared/lib';
import { projectsInTeams, teamsGranting } from '../../projects/access';
import { getProjectsByIds, type ProjectRow } from '../../projects/store';
import { listIssues, userById } from './issue';
import { toTeam } from './team';

// Linear's Project and its items (ProjectStatus, ProjectMilestone, ProjectUpdate,
// ProjectLabel). Project data comes from the REST store (getProjectsByIds), so
// progress, health and the visible-teams rule match REST.

const PRIORITY_LABEL = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];

type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

const readable = (ctx: GraphQLContext) => teamsGranting(ctx.user.id, 'read');

export function toProject(p: ProjectRow) {
  const open = p.progress.total - p.progress.canceled;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    content: p.content,
    // Non-null in Linear's schema; projects without a color get the default grey.
    color: p.color ?? '#bec2c8',
    icon: p.icon,
    slugId: p.slugId,
    priority: p.priority,
    priorityLabel: PRIORITY_LABEL[p.priority] ?? 'No priority',
    prioritySortOrder: p.priority === 0 ? 5 : p.priority,
    sortOrder: p.sortOrder,
    startDate: p.startDate,
    targetDate: p.targetDate,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    archivedAt: p.archivedAt,
    health: p.health,
    progress: open > 0 ? p.progress.completed / open : 0,
    // Deprecated in Linear, still selected by the SDK: the status type.
    state: p.status,
    url: `${trustedOrigins[0]}/projects/${p.id}`,
    trashed: false,
    // Read by the relation resolvers; not schema fields.
    statusId: p.statusId,
    leadUserId: p.leadUserId,
    visibleTeamIds: p.teams.map((t) => t.id),
    labelIds: p.labelIds,
  };
}

type GraphQLProject = ReturnType<typeof toProject>;

// One page of the viewer's visible projects matching `where`, the filter and
// includeArchived.
async function listProjects(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  const teams = await readable(ctx);
  return paginateProjects(
    and(
      inArray(project.id, projectsInTeams(teams)),
      where,
      args.includeArchived ? undefined : isNull(project.archivedAt),
      projectFilterSql(args.filter, ctx.user.id),
    ),
    args,
    teams,
  );
}

async function paginateProjects(where: SQL | undefined, args: PageArgs, teams: string[]) {
  return paginate(
    args,
    { id: project.id, createdAt: project.createdAt, updatedAt: project.updatedAt },
    where,
    async (w, order, limit) => {
      const keys = await db
        .select({ id: project.id, createdAt: project.createdAt, updatedAt: project.updatedAt })
        .from(project)
        .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
        .where(w)
        .orderBy(...order)
        .limit(limit);
      const rows = new Map(
        (
          await getProjectsByIds(
            keys.map((k) => k.id),
            teams,
          )
        ).map((p) => [p.id, p]),
      );
      return keys.map((k) => ({ ...k, project: rows.get(k.id)! }));
    },
    (row) => toProject(row.project),
  );
}

// A visible project by id or slugId, or ENTITY_NOT_FOUND.
export async function findProject(idOrSlug: string, ctx: GraphQLContext): Promise<GraphQLProject> {
  const teams = await readable(ctx);
  const match = UUID_RE.test(idOrSlug) ? eq(project.id, idOrSlug) : eq(project.slugId, idOrSlug);
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(match, inArray(project.id, projectsInTeams(teams))));
  const [found] = row ? await getProjectsByIds([row.id], teams) : [];
  if (!found) throw gqlError('ENTITY_NOT_FOUND', `Project ${idOrSlug} not found`);
  return toProject(found);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toStatus(row: typeof projectStatus.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    description: row.description,
    position: row.position,
    indefinite: row.indefinite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
  };
}

export function toMilestone(row: typeof projectMilestone.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetDate: row.targetDate,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: iso(row.archivedAt),
    projectId: row.projectId,
  };
}

export function toUpdate(row: typeof projectUpdate.$inferSelect) {
  return {
    id: row.id,
    body: row.body,
    health: row.health,
    editedAt: iso(row.editedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    url: `${trustedOrigins[0]}/projects/${row.projectId}`,
    projectId: row.projectId,
    userId: row.userId,
  };
}

export function toLabel(row: typeof projectLabel.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    isGroup: row.isGroup,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    retiredAt: iso(row.retiredAt),
    parentId: row.parentId,
  };
}

// Milestones of the viewer's visible projects (optionally one project).
async function listMilestones(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  const teams = await readable(ctx);
  return paginate(
    args,
    {
      id: projectMilestone.id,
      createdAt: projectMilestone.createdAt,
      updatedAt: projectMilestone.updatedAt,
    },
    and(
      inArray(projectMilestone.projectId, projectsInTeams(teams)),
      where,
      args.includeArchived ? undefined : isNull(projectMilestone.archivedAt),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(projectMilestone)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toMilestone(row),
  );
}

async function listUpdates(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  const teams = await readable(ctx);
  return paginate(
    args,
    {
      id: projectUpdate.id,
      createdAt: projectUpdate.createdAt,
      updatedAt: projectUpdate.updatedAt,
    },
    and(inArray(projectUpdate.projectId, projectsInTeams(teams)), where),
    (w, order, limit) =>
      db
        .select()
        .from(projectUpdate)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toUpdate(row),
  );
}

function listLabels(where: SQL | undefined, args: ConnectionArgs) {
  return paginate(
    args,
    { id: projectLabel.id, createdAt: projectLabel.createdAt, updatedAt: projectLabel.updatedAt },
    and(
      where,
      filterSql(args.filter, {
        id: (v, p) => compareId(projectLabel.id, v, p),
        name: (v, p) => compare(projectLabel.name, v, p),
      }),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(projectLabel)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toLabel(row),
  );
}

// The first row, when its project is visible to the viewer; else ENTITY_NOT_FOUND.
// Used for milestones and updates, which are visible through their project.
async function visibleItem<T extends { projectId: string }>(
  rows: T[],
  ctx: GraphQLContext,
  what: string,
  id: string,
): Promise<T> {
  const row = rows[0];
  if (row) {
    const [visible] = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(
          eq(project.id, row.projectId),
          inArray(project.id, projectsInTeams(await readable(ctx))),
        ),
      );
    if (visible) return row;
  }
  throw gqlError('ENTITY_NOT_FOUND', `${what} ${id} not found`);
}

// An id no row has, for `IN` lists that would otherwise be empty.
const UUID_NONE = '00000000-0000-0000-0000-000000000000';

export const projectResolvers = {
  Query: {
    project: (_: unknown, args: { id: string }, ctx: GraphQLContext) => findProject(args.id, ctx),
    projects: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listProjects(undefined, args, ctx),
    // The six fixed statuses, in lifecycle order, as a single page.
    projectStatuses: async () => {
      const rows = await db.select().from(projectStatus).orderBy(projectStatus.position);
      const edges = rows.map((r) => ({ node: toStatus(r), cursor: r.id }));
      return {
        nodes: edges.map((e) => e.node),
        edges,
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: edges[0]?.cursor ?? null,
          endCursor: edges[edges.length - 1]?.cursor ?? null,
        },
      };
    },
    projectStatus: async (_: unknown, args: { id: string }) => {
      const [row] = UUID_RE.test(args.id)
        ? await db.select().from(projectStatus).where(eq(projectStatus.id, args.id))
        : [];
      if (!row) throw gqlError('ENTITY_NOT_FOUND', `Project status ${args.id} not found`);
      return toStatus(row);
    },
    projectMilestone: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const rows = UUID_RE.test(args.id)
        ? await db.select().from(projectMilestone).where(eq(projectMilestone.id, args.id))
        : [];
      return toMilestone(await visibleItem(rows, ctx, 'Project milestone', args.id));
    },
    projectMilestones: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listMilestones(undefined, args, ctx),
    projectUpdate: async (_: unknown, args: { id: string }, ctx: GraphQLContext) => {
      const rows = UUID_RE.test(args.id)
        ? await db.select().from(projectUpdate).where(eq(projectUpdate.id, args.id))
        : [];
      return toUpdate(await visibleItem(rows, ctx, 'Project update', args.id));
    },
    projectUpdates: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listUpdates(undefined, args, ctx),
    projectLabel: async (_: unknown, args: { id: string }) => {
      const [row] = UUID_RE.test(args.id)
        ? await db.select().from(projectLabel).where(eq(projectLabel.id, args.id))
        : [];
      if (!row) throw gqlError('ENTITY_NOT_FOUND', `Project label ${args.id} not found`);
      return toLabel(row);
    },
    projectLabels: (_: unknown, args: ConnectionArgs) => listLabels(undefined, args),
  },
  Project: {
    status: async (p: GraphQLProject) => {
      const [row] = await db.select().from(projectStatus).where(eq(projectStatus.id, p.statusId));
      return toStatus(row!);
    },
    lead: (p: GraphQLProject, _: unknown, ctx: GraphQLContext) =>
      userById(p.leadUserId, ctx.user.id),
    teams: (p: GraphQLProject, args: ConnectionArgs) =>
      paginate(
        args,
        { id: team.id, createdAt: team.createdAt, updatedAt: team.createdAt },
        inArray(team.id, p.visibleTeamIds.length ? p.visibleTeamIds : [UUID_NONE]),
        (w, order, limit) =>
          db
            .select()
            .from(team)
            .where(w)
            .orderBy(...order)
            .limit(limit)
            .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
        (row) => toTeam(row),
      ),
    issues: (p: GraphQLProject, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.projectId, p.id), args, ctx.user.id),
    projectMilestones: (p: GraphQLProject, args: ConnectionArgs, ctx: GraphQLContext) =>
      listMilestones(eq(projectMilestone.projectId, p.id), args, ctx),
    projectUpdates: (p: GraphQLProject, args: ConnectionArgs, ctx: GraphQLContext) =>
      listUpdates(eq(projectUpdate.projectId, p.id), args, ctx),
    labels: (p: GraphQLProject, args: ConnectionArgs) =>
      listLabels(inArray(projectLabel.id, p.labelIds.length ? p.labelIds : [UUID_NONE]), args),
  },
  ProjectMilestone: {
    project: (m: { projectId: string }, _: unknown, ctx: GraphQLContext) =>
      findProject(m.projectId, ctx),
    issues: (m: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.projectMilestoneId, m.id), args, ctx.user.id),
  },
  ProjectUpdate: {
    project: (u: { projectId: string }, _: unknown, ctx: GraphQLContext) =>
      findProject(u.projectId, ctx),
    user: (u: { userId: string | null }, _: unknown, ctx: GraphQLContext) =>
      userById(u.userId, ctx.user.id),
  },
  ProjectLabel: {
    parent: async (l: { parentId: string | null }) => {
      if (!l.parentId) return null;
      const [row] = await db.select().from(projectLabel).where(eq(projectLabel.id, l.parentId));
      return row ? toLabel(row) : null;
    },
  },
  Team: {
    projects: async (t: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listProjects(inArray(project.id, projectsInTeams([t.id])), args, ctx),
  },
  Issue: {
    project: async (i: { projectId: string | null }, _: unknown, ctx: GraphQLContext) =>
      i.projectId ? findProject(i.projectId, ctx).catch(() => null) : null,
    projectMilestone: async (i: { projectMilestoneId: string | null }) => {
      if (!i.projectMilestoneId) return null;
      const [row] = await db
        .select()
        .from(projectMilestone)
        .where(eq(projectMilestone.id, i.projectMilestoneId));
      return row ? toMilestone(row) : null;
    },
  },
};

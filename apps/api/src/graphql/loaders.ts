import DataLoader from 'dataloader';
import {
  cycle,
  db,
  issue,
  issueLabel,
  label,
  project,
  projectMilestone,
  reaction,
  team,
  user,
  workflowState,
} from '@repo/db';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { mapCycle } from '../cycles/store';
import { projectsInTeams } from '../projects/access';
import { getProjectsByIds } from '../projects/store';
import { listReactions, type ReactionRow } from '../reactions/store';
import { visibleTeamIdList } from '../shared/access';
import type { GraphQLContext } from './context';
import { visibleLabels } from './resolvers/issue-label';
import { visibleUsers } from './resolvers/team';

// Request-scoped loaders for the fields a list resolves once per row (an issue's
// state, team, users, labels, project, milestone, cycle, parent; a comment's or a
// history entry's users; reactions). Each loader collects the keys asked for while
// a level of the query resolves and answers them with one query, so a list of N rows
// makes a bounded number of statements. Visibility is the same as the per-row
// lookups they replace: users and projects come back null when the viewer may not
// see them.

type Row<T extends { $inferSelect: unknown }> = T['$inferSelect'];

const issueColumns = { ...getTableColumns(issue), teamKey: team.key };
export type IssueRecord = Row<typeof issue> & { teamKey: string };

function byId<T extends { id: string }>(rows: T[], keys: readonly string[]): (T | null)[] {
  const found = new Map(rows.map((r) => [r.id, r]));
  return keys.map((k) => found.get(k) ?? null);
}

function grouped<T>(rows: T[], keyOf: (row: T) => string | null, keys: readonly string[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyOf(row);
    if (k == null) continue;
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return keys.map((k) => groups.get(k) ?? []);
}

function createLoaders(ctx: GraphQLContext) {
  const viewerId = ctx.user.id;
  let teams: Promise<string[]> | null = null;
  const readableTeams = () => (teams ??= visibleTeamIdList(viewerId));

  const project_ = new DataLoader(async (keys: readonly string[]) => {
    const visibleTeams = await readableTeams();
    const visible = await db
      .select({ id: project.id })
      .from(project)
      .where(
        and(inArray(project.id, [...keys]), inArray(project.id, projectsInTeams(visibleTeams))),
      );
    const rows = visible.length
      ? await getProjectsByIds(
          visible.map((v) => v.id),
          visibleTeams,
        )
      : [];
    return byId(rows, keys);
  });

  return {
    state: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select()
          .from(workflowState)
          .where(inArray(workflowState.id, [...keys])),
        keys,
      ),
    ),
    team: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select()
          .from(team)
          .where(inArray(team.id, [...keys])),
        keys,
      ),
    ),
    issue: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select(issueColumns)
          .from(issue)
          .innerJoin(team, eq(team.id, issue.teamId))
          .where(inArray(issue.id, [...keys])),
        keys,
      ),
    ),
    cycle: new DataLoader(async (keys: readonly string[]) =>
      byId(
        (
          await db
            .select()
            .from(cycle)
            .where(inArray(cycle.id, [...keys]))
        ).map(mapCycle),
        keys,
      ),
    ),
    // Users the viewer may see (visibleUsers); others resolve to null.
    user: new DataLoader(async (keys: readonly string[]) => {
      return byId(
        await db
          .select()
          .from(user)
          .where(and(inArray(user.id, [...keys]), visibleUsers(viewerId))),
        keys,
      );
    }),
    project: project_,
    // A milestone is visible when its project is.
    milestone: new DataLoader(async (keys: readonly string[]) => {
      const rows = await db
        .select()
        .from(projectMilestone)
        .where(inArray(projectMilestone.id, [...keys]));
      const projects = await project_.loadMany(rows.map((r) => r.projectId));
      const visible = rows.filter((_, i) => {
        const p = projects[i];
        return p != null && !(p instanceof Error);
      });
      return byId(visible, keys);
    }),
    // Label ids on each issue, sorted (Issue.labelIds).
    labelIdsByIssue: new DataLoader(async (keys: readonly string[]) => {
      const rows = await db
        .select({ issueId: issueLabel.issueId, labelId: issueLabel.labelId })
        .from(issueLabel)
        .where(inArray(issueLabel.issueId, [...keys]));
      return grouped(rows, (r) => r.issueId, keys).map((list) => list.map((r) => r.labelId).sort());
    }),
    // The visible labels on each issue (Issue.labels without paging arguments).
    labelsByIssue: new DataLoader(async (keys: readonly string[]) => {
      const rows = await db
        .select({ issueId: issueLabel.issueId, label: getTableColumns(label) })
        .from(issueLabel)
        .innerJoin(label, eq(label.id, issueLabel.labelId))
        .where(and(inArray(issueLabel.issueId, [...keys]), visibleLabels(viewerId)));
      return grouped(rows, (r) => r.issueId, keys).map((list) => list.map((r) => r.label));
    }),
    // Labels by id, without a visibility check (as the history entries' label lists).
    label: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select()
          .from(label)
          .where(inArray(label.id, [...keys])),
        keys,
      ),
    ),
    reactionsByIssue: new DataLoader(async (keys: readonly string[]) =>
      grouped(
        await listReactions(inArray(reaction.issueId, [...keys])),
        (r: ReactionRow) => r.issueId,
        keys,
      ),
    ),
    reactionsByComment: new DataLoader(async (keys: readonly string[]) =>
      grouped(
        await listReactions(inArray(reaction.commentId, [...keys])),
        (r: ReactionRow) => r.commentId,
        keys,
      ),
    ),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;

const perRequest = new WeakMap<GraphQLContext, Loaders>();

// The loaders of this request, created on first use.
export function loaders(ctx: GraphQLContext): Loaders {
  let found = perRequest.get(ctx);
  if (!found) {
    found = createLoaders(ctx);
    perRequest.set(ctx, found);
  }
  return found;
}

// Drops this request's loaders, so the next field starts with empty caches. Run before
// each mutation field: GraphQL runs a document's mutation fields one after another,
// and a later field must not read rows cached before an earlier one changed them.
export function clearLoaders(ctx: GraphQLContext): void {
  perRequest.delete(ctx);
}

import DataLoader from 'dataloader';
import {
  attachment,
  customer,
  cycle,
  db,
  externalUser,
  issue,
  issueLabel,
  label,
  project,
  projectMilestone,
  reaction,
  team,
  user,
  workflowState,
  projectMember,
} from '@repo/db';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { sessionsOfComments } from '../agents/store';
import { mapAttachment } from '../attachments/store';
import { itemsByIds, readsCustomers } from '../customers/statuses';
import { customerIssueCounts, mapCustomer } from '../customers/store';
import { readsFeedback } from '../feedback/access';
import { mapCycle } from '../cycles/store';
import { projectsInTeams } from '../projects/access';
import { getProjectsByIds } from '../projects/store';
import { projectHistories } from '../projects/progress';
import { listReactions, type ReactionRow } from '../reactions/store';
import { releaseIssueCounts } from '../releases/issues';
import { firstTeamKeys, pipelinesByIds } from '../releases/pipelines';
import { stagesByIds } from '../releases/stages';
import { visibleTeamIdList } from '../shared/access';
import type { GraphQLContext } from './context';
import { visibleLabels } from './resolvers/issue-label';
import { visibleUsers } from './resolvers/team';
import { workflowBotActors } from './resolvers/workflow-definition';

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

  let feedbackReader: Promise<boolean> | null = null;
  let customersReader: Promise<boolean> | null = null;

  return {
    // Whether the viewer reads feedback and requesters (feedback/access.ts), asked once.
    readsFeedback: () => (feedbackReader ??= readsFeedback(viewerId)),
    // Whether the viewer reads customers (Customers on, not a guest), asked once.
    readsCustomers: () => (customersReader ??= readsCustomers(viewerId)),
    customer: new DataLoader(async (keys: readonly string[]) =>
      byId(
        (
          await db
            .select()
            .from(customer)
            .where(inArray(customer.id, [...keys]))
        ).map(mapCustomer),
        keys,
      ),
    ),
    customerStatus: new DataLoader(async (keys: readonly string[]) =>
      byId(await itemsByIds('status', keys), keys),
    ),
    customerTier: new DataLoader(async (keys: readonly string[]) =>
      byId(await itemsByIds('tier', keys), keys),
    ),
    customerIssueCount: new DataLoader(async (keys: readonly string[]) => {
      const counts = await customerIssueCounts(viewerId, keys);
      return keys.map((k) => counts.get(k) ?? 0);
    }),
    attachment: new DataLoader(async (keys: readonly string[]) =>
      byId(
        (
          await db
            .select()
            .from(attachment)
            .where(inArray(attachment.id, [...keys]))
        ).map(mapAttachment),
        keys,
      ),
    ),
    // Requesters by id, without following merges (the resolver follows them).
    externalUser: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select()
          .from(externalUser)
          .where(inArray(externalUser.id, [...keys])),
        keys,
      ),
    ),
    // A project's progress histories (projects/progress.ts), built on first need.
    // Callers pass ids of projects the viewer already sees.
    projectHistory: new DataLoader(async (keys: readonly string[]) => {
      const found = await projectHistories([...keys], new Date());
      return keys.map((k) => found.get(k) ?? null);
    }),
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
    // A project's members the viewer may see, in the order they were added (members
    // who stay through a memberIds change keep their place).
    projectMembers: new DataLoader(async (keys: readonly string[]) => {
      const rows = await db
        .select({ projectId: projectMember.projectId, user: getTableColumns(user) })
        .from(projectMember)
        .innerJoin(user, eq(user.id, projectMember.userId))
        .where(and(inArray(projectMember.projectId, [...keys]), visibleUsers(viewerId)))
        .orderBy(projectMember.createdAt, projectMember.userId);
      return grouped(rows, (r) => r.projectId, keys).map((group) => group.map((r) => r.user));
    }),
    user: new DataLoader(async (keys: readonly string[]) => {
      return byId(
        await db
          .select()
          .from(user)
          .where(and(inArray(user.id, [...keys]), visibleUsers(viewerId))),
        keys,
      );
    }),
    // Users by id without the visibility check (the agent API's app users and authors
    // of what the viewer already reads).
    anyUser: new DataLoader(async (keys: readonly string[]) =>
      byId(
        await db
          .select()
          .from(user)
          .where(inArray(user.id, [...keys])),
        keys,
      ),
    ),
    // The workflow that made a history entry or a comment, as Linear's ActorBot.
    workflowBot: new DataLoader((keys: readonly string[]) => workflowBotActors(keys)),
    // Linear's Comment.agentSession for each comment (agents/store.ts).
    sessionOfComment: new DataLoader((keys: readonly string[]) =>
      sessionsOfComments(keys, viewerId),
    ),
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
    // Release fields read for each row of a release list. The release itself was
    // checked visible, so its pipeline and stage are too.
    releasePipeline: new DataLoader(async (keys: readonly string[]) =>
      byId(await pipelinesByIds(keys), keys),
    ),
    releaseStage: new DataLoader(async (keys: readonly string[]) =>
      byId(await stagesByIds(keys), keys),
    ),
    pipelineTeamKey: new DataLoader(async (keys: readonly string[]) => {
      const found = await firstTeamKeys(keys);
      return keys.map((k) => found.get(k) ?? null);
    }),
    releaseIssueCount: new DataLoader(async (keys: readonly string[]) => {
      const counts = await releaseIssueCounts(keys, viewerId);
      return keys.map((k) => counts.get(k) ?? 0);
    }),
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

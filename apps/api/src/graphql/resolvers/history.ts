import { db, issue, issueActivity, team, workflowState } from '@repo/db';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { canSeeTeam } from '../../shared/access';
import type { GraphQLContext } from '../context';
import { loaders } from '../loaders';
import { paginate, type PageArgs } from '../connection';
import { toCycle } from './cycle';
import { issueById, toIssue, userFor } from './issue';
import { toIssueLabel } from './issue-label';
import { findProject, toProject } from './project';
import { toWorkflowState } from './workflow-state';

// Linear's IssueHistory, IssueStateSpan and ProjectHistory, read from the change log
// (`issue_activity`). The typed fields come from the rows' from_id / to_id; rows
// written before those columns existed carry only name snapshots and give null.
// History is reached through an issue or a project the viewer can already see.

type ActivityRow = typeof issueActivity.$inferSelect;

// Linear's relation change codes (IssueRelationHistoryPayload.type), by the subject
// the relation log writes for this issue's side.
const RELATION_CODES: Record<string, [string, string]> = {
  blocks: ['ax', 'rx'],
  blocked_by: ['ab', 'rb'],
  related: ['ar', 'rr'],
  duplicate_of: ['ad', 'rd'],
  duplicated_by: ['am', 'rm'],
};

const num = (v: string | null) => (v == null || v === '' ? null : Number(v));

// One activity row as Linear's IssueHistory. Fields the row does not describe are
// absent and resolve to null.
export function toIssueHistory(row: ActivityRow) {
  const base = {
    id: row.id,
    issueId: row.issueId,
    actorId: row.actorUserId,
    workflowDefinitionId: row.workflowDefinitionId,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    archivedAt: null,
  };
  const ids = { fromId: row.fromId, toId: row.toId };
  switch (row.action) {
    case 'status':
      return { ...base, fromStateId: ids.fromId, toStateId: ids.toId };
    case 'assignee':
      return { ...base, fromAssigneeId: ids.fromId, toAssigneeId: ids.toId };
    case 'delegate':
      return { ...base, fromDelegateId: ids.fromId, toDelegateId: ids.toId };
    case 'project':
      return { ...base, fromProjectId: ids.fromId, toProjectId: ids.toId };
    case 'cycle':
      return { ...base, fromCycleId: ids.fromId, toCycleId: ids.toId };
    case 'parent':
      return { ...base, fromParentId: ids.fromId, toParentId: ids.toId };
    case 'priority':
      return { ...base, fromPriority: num(row.fromText), toPriority: num(row.toText) };
    case 'title':
      return { ...base, fromTitle: row.fromText, toTitle: row.toText };
    case 'due_date':
      return { ...base, fromDueDate: row.fromText, toDueDate: row.toText };
    case 'description':
      return { ...base, updatedDescription: true };
    case 'label_add':
      return { ...base, addedLabelIds: ids.toId ? [ids.toId] : [] };
    case 'label_remove':
      return { ...base, removedLabelIds: ids.fromId ? [ids.fromId] : [] };
    case 'archived':
      return { ...base, archived: true };
    case 'restored':
      return { ...base, archived: false };
    case 'relation': {
      const codes = RELATION_CODES[row.subject ?? ''];
      const added = row.toText != null;
      const identifier = added ? row.toText : row.fromText;
      return {
        ...base,
        // Resolved by IssueHistory.relationChanges, which hides an issue the viewer
        // cannot see.
        relatedIssueId: added ? ids.toId : ids.fromId,
        relationChangeList:
          codes && identifier ? [{ identifier, type: added ? codes[0] : codes[1] }] : [],
      };
    }
    default:
      return base;
  }
}

type GraphQLIssueHistory = ReturnType<typeof toIssueHistory> & Record<string, unknown>;
type ListArgs = PageArgs;

async function stateOrNull(id: unknown, ctx: GraphQLContext) {
  if (typeof id !== 'string') return null;
  const row = await loaders(ctx).state.load(id);
  return row ? toWorkflowState(row) : null;
}

async function cycleOrNull(id: unknown, ctx: GraphQLContext) {
  if (typeof id !== 'string') return null;
  const found = await loaders(ctx).cycle.load(id);
  return found ? toCycle(found) : null;
}

// A parent is in the issue's own team (the store enforces it), so a viewer who reaches
// the history can see it; one that no longer exists resolves to null.
async function issueOrNull(id: unknown, ctx: GraphQLContext) {
  if (typeof id !== 'string') return null;
  const row = await loaders(ctx).issue.load(id);
  return row ? toIssue(row) : null;
}

async function labelsByIds(ids: unknown, ctx: GraphQLContext) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const rows = await loaders(ctx).label.loadMany(ids as string[]);
  const found = [];
  for (const row of rows) if (row && !(row instanceof Error)) found.push(toIssueLabel(row));
  return found;
}

const userOrNull = (id: unknown, ctx: GraphQLContext) =>
  typeof id === 'string' ? userFor(ctx, id) : null;

async function projectOrNull(id: unknown, ctx: GraphQLContext) {
  if (typeof id !== 'string') return null;
  const found = await loaders(ctx).project.load(id);
  return found ? toProject(found) : null;
}

// The state spans of an issue: from its creation in its first recorded state (the
// first change's from-state, or the current state when no change is recorded), then
// one span per status change, the last one open.
async function stateSpans(issueId: string) {
  const [found] = await db
    .select({ createdAt: issue.createdAt, stateId: issue.stateId, teamId: issue.teamId })
    .from(issue)
    .where(eq(issue.id, issueId));
  if (!found) return [];
  const changes = await db
    .select({
      id: issueActivity.id,
      fromId: issueActivity.fromId,
      toId: issueActivity.toId,
      fromText: issueActivity.fromText,
      toText: issueActivity.toText,
      createdAt: issueActivity.createdAt,
    })
    .from(issueActivity)
    .where(and(eq(issueActivity.issueId, issueId), eq(issueActivity.action, 'status')))
    .orderBy(asc(issueActivity.createdAt), asc(issueActivity.id));
  // A status row logged before ids were recorded names its states only: match the
  // name against the team's current states. A name no state has any more keeps the
  // stretch boundary and continues the previous stretch's state.
  const byName = new Map<string, string>();
  if (changes.some((c) => !c.toId || !c.fromId)) {
    const states = await db
      .select({ id: workflowState.id, name: workflowState.name })
      .from(workflowState)
      .where(eq(workflowState.teamId, found.teamId));
    for (const st of states) if (!byName.has(st.name)) byName.set(st.name, st.id);
  }
  const resolve = (id: string | null, text: string | null) =>
    id ?? (text ? byName.get(text) : undefined) ?? null;
  const first = changes[0];
  const spans: { id: string; stateId: string; startedAt: Date; endedAt: Date | null }[] = [
    {
      id: issueId,
      stateId: (first && resolve(first.fromId, first.fromText)) ?? found.stateId,
      startedAt: found.createdAt,
      endedAt: null,
    },
  ];
  for (const change of changes) {
    const previous = spans[spans.length - 1]!;
    previous.endedAt = change.createdAt;
    spans.push({
      id: change.id,
      stateId: resolve(change.toId, change.toText) ?? previous.stateId,
      startedAt: change.createdAt,
      endedAt: null,
    });
  }
  return spans;
}

// A full list as a Linear connection (state spans are few per issue).
function asConnection<T extends { id: string }>(items: T[]) {
  return {
    nodes: items,
    edges: items.map((node) => ({ node, cursor: node.id })),
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: items[0]?.id ?? null,
      endCursor: items[items.length - 1]?.id ?? null,
    },
  };
}

function listActivity(owner: 'issue' | 'project', id: string, args: ListArgs) {
  return paginate(
    args,
    {
      id: issueActivity.id,
      createdAt: issueActivity.createdAt,
      updatedAt: issueActivity.createdAt,
    },
    owner === 'issue' ? eq(issueActivity.issueId, id) : eq(issueActivity.projectId, id),
    (w, order, limit) =>
      db
        .select({ ...getTableColumns(issueActivity), updatedAt: issueActivity.createdAt })
        .from(issueActivity)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row): ActivityRow => row,
  );
}

export const historyResolvers = {
  Issue: {
    history: async (i: { id: string }, args: ListArgs) => {
      const page = await listActivity('issue', i.id, args);
      return {
        ...page,
        nodes: page.nodes.map(toIssueHistory),
        edges: page.edges.map((e) => ({ ...e, node: toIssueHistory(e.node) })),
      };
    },
    stateHistory: async (i: { id: string }) => asConnection(await stateSpans(i.id)),
  },
  IssueStateSpan: {
    state: (s: { stateId: string }, _: unknown, ctx: GraphQLContext) => stateOrNull(s.stateId, ctx),
  },
  IssueHistory: {
    issue: (h: GraphQLIssueHistory) => issueById(h.issueId as string),
    actor: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) => userOrNull(h.actorId, ctx),
    botActor: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      h.workflowDefinitionId ? loaders(ctx).workflowBot.load(h.workflowDefinitionId) : null,
    fromState: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      stateOrNull(h.fromStateId, ctx),
    toState: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      stateOrNull(h.toStateId, ctx),
    fromAssignee: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      userOrNull(h.fromAssigneeId, ctx),
    toAssignee: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      userOrNull(h.toAssigneeId, ctx),
    fromDelegate: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      userOrNull(h.fromDelegateId, ctx),
    toDelegate: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      userOrNull(h.toDelegateId, ctx),
    fromProject: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      projectOrNull(h.fromProjectId, ctx),
    toProject: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      projectOrNull(h.toProjectId, ctx),
    fromCycle: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      cycleOrNull(h.fromCycleId, ctx),
    toCycle: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      cycleOrNull(h.toCycleId, ctx),
    fromParent: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      issueOrNull(h.fromParentId, ctx),
    toParent: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      issueOrNull(h.toParentId, ctx),
    // The related issue is named only when the viewer can see it; a row written
    // before ids were recorded names an issue that cannot be checked, so it is left out.
    relationChanges: async (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) => {
      const list = (h.relationChangeList as unknown[] | undefined) ?? null;
      if (!list) return null;
      if (typeof h.relatedIssueId !== 'string') return [];
      const [row] = await db
        .select({ teamId: issue.teamId, seq: issue.sequenceNumber, key: team.key })
        .from(issue)
        .innerJoin(team, eq(team.id, issue.teamId))
        .where(eq(issue.id, h.relatedIssueId));
      if (!row || !(await canSeeTeam(row.teamId, ctx.user.id))) return [];
      // The log text hides a cross-team identifier; a viewer who can see it gets it.
      return (list as { type: string }[]).map((c) => ({
        ...c,
        identifier: `${row.key}-${row.seq}`,
      }));
    },
    addedLabels: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      labelsByIds(h.addedLabelIds, ctx),
    removedLabels: (h: GraphQLIssueHistory, _: unknown, ctx: GraphQLContext) =>
      labelsByIds(h.removedLabelIds, ctx),
  },
  Project: {
    history: async (p: { id: string }, args: ListArgs) => {
      const toNode = (row: ActivityRow) => ({
        id: row.id,
        projectId: row.projectId,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
        archivedAt: null,
        entries: {
          action: row.action,
          subject: row.subject,
          from: row.fromText,
          to: row.toText,
          fromId: row.fromId,
          toId: row.toId,
          actorId: row.actorUserId,
          actorName: row.actorName,
        },
      });
      const page = await listActivity('project', p.id, args);
      return {
        ...page,
        nodes: page.nodes.map(toNode),
        edges: page.edges.map((e) => ({ ...e, node: toNode(e.node) })),
      };
    },
  },
  ProjectHistory: {
    project: (h: { projectId: string }, _: unknown, ctx: GraphQLContext) =>
      findProject(h.projectId, ctx).catch(() => null),
  },
};

import { ToolError, type Gql } from '../graphql';
import {
  resolveCycle,
  resolveIssueId,
  resolveLabels,
  resolveProject,
  resolveState,
  resolveTeam,
  resolveUser,
  STATE_TYPES,
} from '../resolve';
import type { McpTool } from '../types';
import {
  bool,
  int,
  nextCursor,
  nullableInt,
  nullableStr,
  object,
  PAGE_INFO,
  pageArgs,
  paging,
  str,
  strList,
} from './schema';

// Issue tools: list, list mine, get, create, update.

const ISSUE_SUMMARY = `id identifier title url priority updatedAt completedAt
  state { name type } assignee { name } team { key name } project { name }
  cycle { number name } labels { nodes { name } }`;

const ISSUE_DETAIL = `${ISSUE_SUMMARY} description estimate dueDate createdAt branchName
  delegate { name } parent { identifier title } children(first: 250) { nodes { identifier title } }
  attachments(first: 250) { nodes { title url } }`;

interface IssueNode {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  completedAt: string | null;
  state: { name: string; type: string };
  assignee: { name: string } | null;
  team: { key: string; name: string };
  project: { name: string } | null;
  cycle: { number: number; name: string | null } | null;
  labels: { nodes: { name: string }[] };
  description?: string | null;
  estimate?: number | null;
  dueDate?: string | null;
  createdAt?: string;
  branchName?: string;
  delegate?: { name: string } | null;
  parent?: { identifier: string; title: string } | null;
  children?: { nodes: { identifier: string; title: string }[] };
  attachments?: { nodes: { title: string; url: string }[] };
}

function summary(i: IssueNode) {
  return {
    id: i.id,
    identifier: i.identifier,
    title: i.title,
    url: i.url,
    priority: i.priority,
    state: i.state,
    assignee: i.assignee,
    team: i.team,
    project: i.project?.name ?? null,
    cycle: i.cycle ? (i.cycle.name ?? `Cycle ${i.cycle.number}`) : null,
    labels: i.labels.nodes,
    updatedAt: i.updatedAt,
    completedAt: i.completedAt,
  };
}

function detail(i: IssueNode) {
  return {
    ...summary(i),
    description: i.description ?? null,
    estimate: i.estimate ?? null,
    dueDate: i.dueDate ?? null,
    createdAt: i.createdAt,
    branchName: i.branchName,
    delegate: i.delegate ?? null,
    parent: i.parent ?? null,
    children: i.children?.nodes ?? [],
    attachments: i.attachments?.nodes ?? [],
  };
}

const DURATION =
  /^-?P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

// The start of a "since" filter: an ISO-8601 date or date-time as given, or a duration
// ("-P7D", "P2W", "PT12H") counted back from now, as Linear's list_issues accepts.
export function sinceDate(value: string, now = new Date()): string {
  const m = DURATION.exec(value.trim());
  if (m && value.trim() !== 'P' && value.trim() !== '-P') {
    const [, y, mo, w, d, h, mi, s] = m.map((x) => Number(x ?? 0));
    const date = new Date(now);
    date.setUTCFullYear(date.getUTCFullYear() - y!, date.getUTCMonth() - mo!);
    date.setUTCDate(date.getUTCDate() - (w! * 7 + d!));
    date.setTime(date.getTime() - ((h! * 60 + mi!) * 60 + s!) * 1000);
    return date.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new ToolError(`completedAt "${value}" is neither an ISO-8601 date nor a duration`);
  return parsed.toISOString();
}

// The IssueFilter for list_issues' arguments; names are resolved as the caller.
async function issueFilter(gql: Gql, args: Record<string, unknown>) {
  const filter: Record<string, unknown> = {};
  const team = args.team ? await resolveTeam(gql, String(args.team)) : null;
  if (team) filter.team = { id: { eq: team.id } };
  if (args.state) {
    const ref = String(args.state);
    if (team) filter.state = { id: { eq: (await resolveState(gql, team.id, ref)).id } };
    else if (STATE_TYPES.includes(ref.toLowerCase()))
      filter.state = { type: { eq: ref.toLowerCase() } };
    else filter.state = { name: { eqIgnoreCase: ref } };
  }
  if (args.assignee !== undefined) {
    const ref = args.assignee === null ? 'none' : String(args.assignee);
    if (ref.toLowerCase() === 'none') filter.assignee = { null: true };
    else if (ref.toLowerCase() === 'me') filter.assignee = { isMe: { eq: true } };
    else filter.assignee = { id: { eq: (await resolveUser(gql, ref)).id } };
  }
  if (args.label) filter.labels = { some: { name: { eqIgnoreCase: String(args.label) } } };
  if (args.project)
    filter.project = { id: { eq: (await resolveProject(gql, String(args.project))).id } };
  if (args.cycle !== undefined) {
    if (!team) throw new ToolError('Give the team to filter by cycle');
    filter.cycle = { id: { eq: await resolveCycle(gql, team.id, args.cycle as string) } };
  }
  if (args.completedAt) filter.completedAt = { gte: sinceDate(String(args.completedAt)) };
  return filter;
}

interface Page {
  nodes: IssueNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const listIssues: McpTool = {
  name: 'list_issues',
  description:
    'List issues, newest first, filtered by team, status, assignee, label, project, cycle, ' +
    'text or completion date. Each filter takes a name, key or id.',
  readOnly: true,
  inputSchema: object({
    team: str('Team key, name or id'),
    state: str(
      'Status name or id, or a status type: backlog, unstarted, started, completed, canceled',
    ),
    assignee: nullableStr('"me", a person\'s name, email or id, or null / "none" for unassigned'),
    label: str('Label name'),
    project: str('Project name or id'),
    cycle: str('Cycle number, name or id, or "current", "next", "previous" (needs team)'),
    query: str('Text to find in the title or description, or an issue number'),
    completedAt: str('Completed on or after this ISO-8601 date, or within a duration such as -P7D'),
    includeArchived: bool('Include archived issues'),
    ...paging,
  }),
  async run(gql, args) {
    const filter = await issueFilter(gql, args);
    const vars = { filter, includeArchived: args.includeArchived ?? false, ...pageArgs(args) };
    let page: Page;
    if (args.query) {
      const data = await gql<{ searchIssues: Page }>(
        `query($term: String!, $filter: IssueFilter, $first: Int, $after: String, $includeArchived: Boolean) {
          searchIssues(term: $term, filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
            nodes { ${ISSUE_SUMMARY} } ${PAGE_INFO} } }`,
        { ...vars, term: String(args.query) },
      );
      page = data.searchIssues;
    } else {
      const data = await gql<{ issues: Page }>(
        `query($filter: IssueFilter, $first: Int, $after: String, $includeArchived: Boolean) {
          issues(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
            nodes { ${ISSUE_SUMMARY} } ${PAGE_INFO} } }`,
        vars,
      );
      page = data.issues;
    }
    return { issues: page.nodes.map(summary), nextCursor: nextCursor(page.pageInfo) };
  },
};

const listMyIssues: McpTool = {
  name: 'list_my_issues',
  description: 'List the issues assigned to you, newest first, optionally by status type.',
  readOnly: true,
  inputSchema: object({
    state: str('A status type: backlog, unstarted, started, completed, canceled'),
    ...paging,
  }),
  async run(gql, args) {
    const filter = args.state ? { state: { type: { eq: String(args.state).toLowerCase() } } } : {};
    const data = await gql<{ viewer: { assignedIssues: Page } }>(
      `query($filter: IssueFilter, $first: Int, $after: String) { viewer {
        assignedIssues(filter: $filter, first: $first, after: $after) {
          nodes { ${ISSUE_SUMMARY} } ${PAGE_INFO} } } }`,
      { filter, ...pageArgs(args) },
    );
    const page = data.viewer.assignedIssues;
    return { issues: page.nodes.map(summary), nextCursor: nextCursor(page.pageInfo) };
  },
};

async function getIssue(gql: Gql, id: string) {
  const data = await gql<{ issue: IssueNode }>(
    `query($id: String!) { issue(id: $id) { ${ISSUE_DETAIL} } }`,
    { id },
  );
  return detail(data.issue);
}

const getIssueTool: McpTool = {
  name: 'get_issue',
  description: 'Get an issue by its identifier ("ENG-42") or id, with its description.',
  readOnly: true,
  inputSchema: object({ id: str('Issue identifier ("ENG-42") or id') }, ['id']),
  run: (gql, args) => getIssue(gql, String(args.id)),
};

// The issue fields create_issue and update_issue share, resolved within the team.
async function issueInput(gql: Gql, teamId: string, args: Record<string, unknown>) {
  const input: Record<string, unknown> = {};
  for (const field of ['title', 'description', 'priority', 'estimate', 'dueDate'])
    if (args[field] !== undefined) input[field] = args[field];
  if (args.state) input.stateId = (await resolveState(gql, teamId, String(args.state))).id;
  if (args.assignee !== undefined)
    input.assigneeId =
      args.assignee === null ? null : (await resolveUser(gql, String(args.assignee))).id;
  if (args.labels !== undefined)
    input.labelIds = await resolveLabels(gql, teamId, (args.labels as string[]) ?? []);
  if (args.project !== undefined)
    input.projectId =
      args.project === null ? null : (await resolveProject(gql, String(args.project))).id;
  if (args.cycle !== undefined)
    input.cycleId =
      args.cycle === null ? null : await resolveCycle(gql, teamId, args.cycle as string);
  if (args.parent !== undefined)
    input.parentId = args.parent === null ? null : await resolveIssueId(gql, String(args.parent));
  return input;
}

const ISSUE_FIELD_SCHEMA = {
  description: str('Markdown description'),
  state: str(
    'Status name or id, or a status type (backlog, unstarted, started, completed, canceled)',
  ),
  assignee: nullableStr('A person\'s name, email or id, or "me"; null to unassign'),
  priority: int('0 none, 1 urgent, 2 high, 3 medium, 4 low', { minimum: 0, maximum: 4 }),
  labels: strList("Label names or ids (replaces the issue's labels)"),
  project: nullableStr('Project name or id; null to remove'),
  cycle: nullableStr('Cycle number, name or id, or "current" / "next"; null to remove'),
  parent: nullableStr('Parent issue identifier or id; null to remove'),
  dueDate: nullableStr('Due date (YYYY-MM-DD); null to clear'),
  estimate: nullableInt(
    "Estimate on the team's scale (Team.issueEstimationType: exponential 1–16, fibonacci 1–8, linear 1–5, tShirt XS–XL as 1, 2, 3, 5, 8; extended and zero if the team allows them); null to clear. Refused while the team does not use estimates.",
  ),
};

const createIssue: McpTool = {
  name: 'create_issue',
  description: 'Create an issue in a team. Status, people, labels and project are given by name.',
  readOnly: false,
  inputSchema: object(
    { team: str('Team key, name or id'), title: str('Issue title'), ...ISSUE_FIELD_SCHEMA },
    ['team', 'title'],
  ),
  async run(gql, args) {
    const team = await resolveTeam(gql, String(args.team));
    const input = { ...(await issueInput(gql, team.id, args)), teamId: team.id };
    const data = await gql<{ issueCreate: { issue: IssueNode } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE_DETAIL} } } }`,
      { input },
    );
    return detail(data.issueCreate.issue);
  },
};

const updateIssue: McpTool = {
  name: 'update_issue',
  description:
    'Update an issue: title, description, status, assignee, priority, labels, project, ' +
    'cycle, parent, due date or estimate. Only the given fields change.',
  readOnly: false,
  inputSchema: object(
    {
      id: str('Issue identifier ("ENG-42") or id'),
      title: str('Issue title'),
      ...ISSUE_FIELD_SCHEMA,
    },
    ['id'],
  ),
  async run(gql, args) {
    const current = await gql<{ issue: { id: string; team: { id: string } } }>(
      'query($id: String!) { issue(id: $id) { id team { id } } }',
      { id: String(args.id) },
    );
    const input = await issueInput(gql, current.issue.team.id, args);
    if (!Object.keys(input).length) throw new ToolError('Nothing to update');
    const data = await gql<{ issueUpdate: { issue: IssueNode } }>(
      `mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { issue { ${ISSUE_DETAIL} } } }`,
      { id: current.issue.id, input },
    );
    return detail(data.issueUpdate.issue);
  },
};

export const issueTools: McpTool[] = [
  listIssues,
  listMyIssues,
  getIssueTool,
  createIssue,
  updateIssue,
];

import type { Gql } from '../graphql';
import {
  bestMatches,
  lower,
  pick,
  resolveCycle,
  resolveIssueId,
  resolveProject,
  resolveState,
  resolveTeam,
  resolveUser,
  teamStates,
} from '../resolve';
import type { McpTool } from '../types';
import { nextCursor, object, PAGE_INFO, pageArgs, paging, str } from './schema';

// Teams, people, statuses, labels, cycles and documents.

const listTeams: McpTool = {
  name: 'list_teams',
  description: 'List the teams you can see, optionally by part of the name or key.',
  readOnly: true,
  inputSchema: object({ query: str('Part of the team name or key') }),
  async run(gql, args) {
    const data = await gql<{
      teams: {
        nodes: {
          id: string;
          key: string;
          name: string;
          description: string | null;
          private: boolean;
        }[];
      };
    }>('query { teams(first: 250) { nodes { id key name description private } } }');
    const q = args.query ? String(args.query).toLowerCase() : null;
    const teams = data.teams.nodes.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.key.toLowerCase().includes(q),
    );
    return { teams };
  },
};

const getTeam: McpTool = {
  name: 'get_team',
  description: 'Get a team by key, name or id, with its statuses.',
  readOnly: true,
  inputSchema: object({ team: str('Team key, name or id') }, ['team']),
  async run(gql, args) {
    const ref = await resolveTeam(gql, String(args.team));
    const data = await gql<{
      team: {
        id: string;
        key: string;
        name: string;
        description: string | null;
        private: boolean;
        cyclesEnabled: boolean;
      };
    }>('query($id: String!) { team(id: $id) { id key name description private cyclesEnabled } }', {
      id: ref.id,
    });
    const states = await teamStates(gql, ref.id);
    return { ...data.team, statuses: states.map(({ id, name, type }) => ({ id, name, type })) };
  },
};

const USER_FIELDS = 'id name displayName email active admin guest app';

interface UserNode {
  id: string;
  name: string;
  displayName: string;
  email: string;
  active: boolean;
  admin: boolean;
  guest: boolean;
  app: boolean;
}

const listUsers: McpTool = {
  name: 'list_users',
  description:
    'List people in the workspace, or in a team, optionally by part of the name or email.',
  readOnly: true,
  inputSchema: object({
    team: str('Team key, name or id'),
    query: str('Part of the name or email'),
  }),
  async run(gql, args) {
    const q = args.query ? String(args.query) : null;
    const filter = q
      ? { or: [{ name: { containsIgnoreCase: q } }, { email: { containsIgnoreCase: q } }] }
      : {};
    if (args.team) {
      const team = await resolveTeam(gql, String(args.team));
      const data = await gql<{ team: { members: { nodes: UserNode[] } } }>(
        `query($id: String!, $filter: UserFilter) { team(id: $id) {
          members(first: 250, filter: $filter) { nodes { ${USER_FIELDS} } } } }`,
        { id: team.id, filter },
      );
      return { users: data.team.members.nodes };
    }
    const data = await gql<{ users: { nodes: UserNode[] } }>(
      `query($filter: UserFilter) { users(first: 250, filter: $filter) { nodes { ${USER_FIELDS} } } }`,
      { filter },
    );
    return { users: data.users.nodes };
  },
};

const getUser: McpTool = {
  name: 'get_user',
  description: 'Get a person by "me", id, email or name.',
  readOnly: true,
  inputSchema: object({ user: str('"me", or a person\'s id, email or name') }, ['user']),
  async run(gql, args) {
    const ref = await resolveUser(gql, String(args.user));
    const data = await gql<{ user: UserNode }>(
      `query($id: String!) { user(id: $id) { ${USER_FIELDS} } }`,
      { id: ref.id },
    );
    return data.user;
  },
};

const listIssueStatuses: McpTool = {
  name: 'list_issue_statuses',
  description: "List a team's issue statuses in board order, each with its type.",
  readOnly: true,
  inputSchema: object({ team: str('Team key, name or id') }, ['team']),
  async run(gql, args) {
    const team = await resolveTeam(gql, String(args.team));
    const states = await teamStates(gql, team.id);
    return { statuses: states.map(({ id, name, type }) => ({ id, name, type })) };
  },
};

const getIssueStatus: McpTool = {
  name: 'get_issue_status',
  description: "Get one of a team's issue statuses by name, id or type.",
  readOnly: true,
  inputSchema: object({ team: str('Team key, name or id'), name: str('Status name, id or type') }, [
    'team',
    'name',
  ]),
  async run(gql, args) {
    const team = await resolveTeam(gql, String(args.team));
    const { id, name, type } = await resolveState(gql, team.id, String(args.name));
    return { id, name, type };
  },
};

interface LabelNode {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isGroup: boolean;
  team: { key: string } | null;
  parent: { name: string } | null;
}

const LABEL_FIELDS = 'id name color description isGroup team { key } parent { name }';

const toLabel = (l: LabelNode) => ({
  id: l.id,
  name: l.name,
  color: l.color,
  description: l.description,
  isGroup: l.isGroup,
  team: l.team?.key ?? null,
  group: l.parent?.name ?? null,
});

const listIssueLabels: McpTool = {
  name: 'list_issue_labels',
  description: "List issue labels: a team's and the workspace's, or all you can see.",
  readOnly: true,
  inputSchema: object({ team: str('Team key, name or id'), query: str('Part of the label name') }),
  async run(gql, args) {
    const parts: Record<string, unknown>[] = [];
    if (args.team) {
      const team = await resolveTeam(gql, String(args.team));
      parts.push({ or: [{ team: { id: { eq: team.id } } }, { team: { null: true } }] });
    }
    if (args.query) parts.push({ name: { containsIgnoreCase: String(args.query) } });
    const data = await gql<{ issueLabels: { nodes: LabelNode[] } }>(
      `query($filter: IssueLabelFilter) { issueLabels(first: 250, filter: $filter) {
        nodes { ${LABEL_FIELDS} } } }`,
      { filter: parts.length ? { and: parts } : {} },
    );
    return { labels: data.issueLabels.nodes.map(toLabel) };
  },
};

interface GroupRef {
  id: string;
  name: string;
  team: { id: string } | null;
}

// A label group by id or name (any case): the team's groups and the workspace groups
// for a team label (a team group wins over a workspace group of the same name), only
// the workspace groups for a workspace label.
async function resolveLabelGroup(gql: Gql, teamId: unknown, ref: string): Promise<string> {
  const scope = teamId
    ? { or: [{ team: { id: { eq: teamId } } }, { team: { null: true } }] }
    : { team: { null: true } };
  const data = await gql<{ issueLabels: { nodes: GroupRef[] } }>(
    `query($filter: IssueLabelFilter) { issueLabels(first: 250, filter: $filter) {
      nodes { id name team { id } } } }`,
    { filter: { and: [{ isGroup: { eq: true } }, scope] } },
  );
  const r = lower(ref);
  const matches = bestMatches(data.issueLabels.nodes, [
    (g) => g.id === ref.trim(),
    (g) => lower(g.name) === r && g.team !== null,
    (g) => lower(g.name) === r,
  ]);
  return pick('label group', ref, matches, (g) => `${g.name} (id ${g.id})`).id;
}

const createIssueLabel: McpTool = {
  name: 'create_issue_label',
  description: 'Create an issue label in a team, or a workspace label when no team is given.',
  readOnly: false,
  inputSchema: object(
    {
      name: str('Label name'),
      team: str('Team key, name or id'),
      color: str('Hex color, e.g. #e5484d'),
      description: str('What the label means'),
      group: str('Name or id of the label group to put it in'),
    },
    ['name'],
  ),
  async run(gql, args) {
    const input: Record<string, unknown> = { name: String(args.name) };
    if (args.team) input.teamId = (await resolveTeam(gql, String(args.team))).id;
    if (args.color) input.color = String(args.color);
    if (args.description) input.description = String(args.description);
    if (args.group) input.parentId = await resolveLabelGroup(gql, input.teamId, String(args.group));
    const data = await gql<{ issueLabelCreate: { issueLabel: LabelNode } }>(
      `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) {
        issueLabel { ${LABEL_FIELDS} } } }`,
      { input },
    );
    return toLabel(data.issueLabelCreate.issueLabel);
  },
};

interface CycleNode {
  id: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  progress: number;
}

const listCycles: McpTool = {
  name: 'list_cycles',
  description: "List a team's cycles, newest first: all, or the current, next or previous one.",
  readOnly: true,
  inputSchema: object(
    {
      team: str('Team key, name or id'),
      type: {
        type: 'string',
        enum: ['all', 'current', 'next', 'previous'],
        description: 'Which cycles',
      },
    },
    ['team'],
  ),
  async run(gql, args) {
    const team = await resolveTeam(gql, String(args.team));
    const type = String(args.type ?? 'all');
    const ids = type === 'all' ? null : [await resolveCycle(gql, team.id, type)];
    const filter: Record<string, unknown> = { team: { id: { eq: team.id } } };
    if (ids) filter.id = { in: ids };
    const data = await gql<{ cycles: { nodes: CycleNode[] } }>(
      `query($filter: CycleFilter) { cycles(first: 250, filter: $filter) {
        nodes { id number name startsAt endsAt completedAt progress } } }`,
      { filter },
    );
    return {
      cycles: data.cycles.nodes.map((c) => ({ ...c, name: c.name ?? `Cycle ${c.number}` })),
    };
  },
};

interface DocumentNode {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
  project: { name: string } | null;
  issue: { identifier: string } | null;
  content?: string | null;
}

const DOCUMENT_FIELDS = 'id title url updatedAt project { name } issue { identifier }';

const toDocument = (d: DocumentNode) => ({
  id: d.id,
  title: d.title,
  url: d.url,
  project: d.project?.name ?? null,
  issue: d.issue?.identifier ?? null,
  updatedAt: d.updatedAt,
  ...(d.content !== undefined ? { content: d.content } : {}),
});

const listDocuments: McpTool = {
  name: 'list_documents',
  description: "List documents, newest first: a project's, an issue's, or by part of the title.",
  readOnly: true,
  inputSchema: object({
    project: str('Project name or id'),
    issue: str('Issue identifier ("ENG-42") or id'),
    query: str('Part of the title'),
    ...paging,
  }),
  async run(gql, args) {
    const filter: Record<string, unknown> = {};
    if (args.project)
      filter.project = { id: { eq: (await resolveProject(gql, String(args.project))).id } };
    if (args.issue) filter.issue = { id: { eq: await resolveIssueId(gql, String(args.issue)) } };
    if (args.query) filter.title = { containsIgnoreCase: String(args.query) };
    const data = await gql<{
      documents: {
        nodes: DocumentNode[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    }>(
      `query($filter: DocumentFilter, $first: Int, $after: String) {
        documents(filter: $filter, first: $first, after: $after) {
          nodes { ${DOCUMENT_FIELDS} } ${PAGE_INFO} } }`,
      { filter, ...pageArgs(args) },
    );
    return {
      documents: data.documents.nodes.map(toDocument),
      nextCursor: nextCursor(data.documents.pageInfo),
    };
  },
};

const getDocument: McpTool = {
  name: 'get_document',
  description: 'Get a document by id, with its Markdown content.',
  readOnly: true,
  inputSchema: object({ id: str('Document id or slug id') }, ['id']),
  async run(gql, args) {
    const data = await gql<{ document: DocumentNode }>(
      `query($id: String!) { document(id: $id) { ${DOCUMENT_FIELDS} content } }`,
      { id: String(args.id) },
    );
    return toDocument(data.document);
  },
};

export const workspaceTools: McpTool[] = [
  listTeams,
  getTeam,
  listUsers,
  getUser,
  listIssueStatuses,
  getIssueStatus,
  listIssueLabels,
  createIssueLabel,
  listCycles,
  listDocuments,
  getDocument,
];

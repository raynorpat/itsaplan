import { ToolError, type Gql } from '../graphql';
import { resolveProject, resolveTeam, resolveUser } from '../resolve';
import type { McpTool } from '../types';
import {
  bool,
  nextCursor,
  nullableStr,
  object,
  PAGE_INFO,
  pageArgs,
  paging,
  str,
  strList,
} from './schema';

// Project tools: list, get, create, update, and the workspace's project labels.

const PROJECT_SUMMARY = `id name description url progress startDate targetDate
  status { name type } lead { name } teams(first: 250) { nodes { key name } }`;

const PROJECT_DETAIL = `${PROJECT_SUMMARY} content priority
  projectMilestones(first: 250) { nodes { name targetDate } }`;

interface ProjectNode {
  id: string;
  name: string;
  description: string;
  url: string;
  progress: number;
  startDate: string | null;
  targetDate: string | null;
  status: { name: string; type: string } | null;
  lead: { name: string } | null;
  teams: { nodes: { key: string; name: string }[] };
  content?: string | null;
  priority?: number;
  projectMilestones?: { nodes: { name: string; targetDate: string | null }[] };
}

function summary(p: ProjectNode) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    url: p.url,
    status: p.status,
    lead: p.lead,
    startDate: p.startDate,
    targetDate: p.targetDate,
    progress: p.progress,
    teams: p.teams.nodes,
  };
}

function detail(p: ProjectNode) {
  return {
    ...summary(p),
    content: p.content ?? null,
    priority: p.priority ?? 0,
    milestones: p.projectMilestones?.nodes ?? [],
  };
}

// A project status by name or type (backlog, planned, started, paused, completed,
// canceled).
async function resolveStatus(gql: Gql, ref: string): Promise<string> {
  const data = await gql<{
    projectStatuses: { nodes: { id: string; name: string; type: string }[] };
  }>('query { projectStatuses { nodes { id name type } } }');
  const r = ref.trim().toLowerCase();
  const found =
    data.projectStatuses.nodes.find((s) => s.id === ref.trim() || s.name.toLowerCase() === r) ??
    data.projectStatuses.nodes.find((s) => s.type === r);
  if (!found)
    throw new ToolError(
      `No project status "${ref}"; use one of ${data.projectStatuses.nodes.map((s) => s.name).join(', ')}`,
    );
  return found.id;
}

async function projectInput(gql: Gql, args: Record<string, unknown>) {
  const input: Record<string, unknown> = {};
  for (const field of ['name', 'description', 'content', 'startDate', 'targetDate', 'priority'])
    if (args[field] !== undefined) input[field] = args[field];
  if (args.lead !== undefined)
    input.leadId = args.lead === null ? null : (await resolveUser(gql, String(args.lead))).id;
  if (args.status) input.statusId = await resolveStatus(gql, String(args.status));
  if (args.teams)
    input.teamIds = await Promise.all(
      (args.teams as string[]).map(async (t) => (await resolveTeam(gql, t)).id),
    );
  return input;
}

const PROJECT_FIELD_SCHEMA = {
  description: str('Short summary'),
  content: str('Markdown description'),
  lead: nullableStr('Lead: a person\'s name, email or id, or "me"; null to clear'),
  status: str('Status name or type: backlog, planned, started, paused, completed, canceled'),
  startDate: nullableStr('Start date (YYYY-MM-DD)'),
  targetDate: nullableStr('Target date (YYYY-MM-DD)'),
};

interface Page {
  nodes: ProjectNode[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

const listProjects: McpTool = {
  name: 'list_projects',
  description: 'List projects, newest first, optionally of a team or by part of the name.',
  readOnly: true,
  inputSchema: object({
    team: str('Team key, name or id'),
    query: str('Part of the project name'),
    includeArchived: bool('Include archived projects'),
    ...paging,
  }),
  async run(gql, args) {
    const filter: Record<string, unknown> = {};
    if (args.team)
      filter.accessibleTeams = {
        some: { id: { eq: (await resolveTeam(gql, String(args.team))).id } },
      };
    if (args.query) filter.name = { containsIgnoreCase: String(args.query) };
    const data = await gql<{ projects: Page }>(
      `query($filter: ProjectFilter, $first: Int, $after: String, $includeArchived: Boolean) {
        projects(filter: $filter, first: $first, after: $after, includeArchived: $includeArchived) {
          nodes { ${PROJECT_SUMMARY} } ${PAGE_INFO} } }`,
      { filter, includeArchived: args.includeArchived ?? false, ...pageArgs(args) },
    );
    return {
      projects: data.projects.nodes.map(summary),
      nextCursor: nextCursor(data.projects.pageInfo),
    };
  },
};

async function getProject(gql: Gql, id: string) {
  const data = await gql<{ project: ProjectNode }>(
    `query($id: String!) { project(id: $id) { ${PROJECT_DETAIL} } }`,
    { id },
  );
  return detail(data.project);
}

const getProjectTool: McpTool = {
  name: 'get_project',
  description: 'Get a project by name or id, with its description and milestones.',
  readOnly: true,
  inputSchema: object({ project: str('Project name or id') }, ['project']),
  async run(gql, args) {
    return getProject(gql, (await resolveProject(gql, String(args.project))).id);
  },
};

const createProject: McpTool = {
  name: 'create_project',
  description: 'Create a project in one or more teams.',
  readOnly: false,
  inputSchema: object(
    {
      name: str('Project name'),
      teams: strList('Team keys, names or ids'),
      ...PROJECT_FIELD_SCHEMA,
    },
    ['name', 'teams'],
  ),
  async run(gql, args) {
    if (!(args.teams as string[] | undefined)?.length)
      throw new ToolError('A project needs at least one team');
    const input = await projectInput(gql, args);
    const data = await gql<{ projectCreate: { project: ProjectNode } }>(
      `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { project { ${PROJECT_DETAIL} } } }`,
      { input },
    );
    return detail(data.projectCreate.project);
  },
};

const updateProject: McpTool = {
  name: 'update_project',
  description: 'Update a project. Only the given fields change; teams replaces the team list.',
  readOnly: false,
  inputSchema: object(
    {
      project: str('Project name or id'),
      name: str('Project name'),
      teams: strList('Team keys, names or ids (replaces the teams)'),
      ...PROJECT_FIELD_SCHEMA,
    },
    ['project'],
  ),
  async run(gql, args) {
    const project = await resolveProject(gql, String(args.project));
    const input = await projectInput(gql, args);
    if (!Object.keys(input).length) throw new ToolError('Nothing to update');
    const data = await gql<{ projectUpdate: { project: ProjectNode } }>(
      `mutation($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) { project { ${PROJECT_DETAIL} } } }`,
      { id: project.id, input },
    );
    return detail(data.projectUpdate.project);
  },
};

const listProjectLabels: McpTool = {
  name: 'list_project_labels',
  description: "List the workspace's project labels.",
  readOnly: true,
  inputSchema: object({}),
  async run(gql) {
    const data = await gql<{
      projectLabels: {
        nodes: { id: string; name: string; color: string; description: string | null }[];
      };
    }>('query { projectLabels(first: 250) { nodes { id name color description } } }');
    return { labels: data.projectLabels.nodes };
  },
};

export const projectTools: McpTool[] = [
  listProjects,
  getProjectTool,
  createProject,
  updateProject,
  listProjectLabels,
];

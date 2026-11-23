import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  type Project,
  type ProjectHealth,
  type ProjectMilestone,
  type ProjectStatus,
} from '@/lib/api';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { toProjectInput, type ProjectChange } from '@/utils/projectInput';
import { patchProject } from '@/utils/projectPatch';
import { toProjectFilter, type ProjectListFilters } from '@/utils/projectFilter';

// The project fields the list, the pickers and the detail page read, mapped onto the
// web's Project shape. progress counts come from Linear's count histories (each holds
// the current value only) and scope (open issues: total minus canceled).
export const ProjectFields = graphql(`
  fragment ProjectFields on Project {
    id
    name
    description
    content
    priority
    sortOrder
    slugId
    startDate
    targetDate
    createdAt
    updatedAt
    archivedAt
    labelIds
    health
    scope
    issueCountHistory
    completedIssueCountHistory
    status {
      id
      type
    }
    lead {
      id
    }
    teams {
      nodes {
        id
        key
        name
      }
    }
  }
`);

const last = (values: readonly number[]) => values[values.length - 1] ?? 0;

export function toProject(data: FragmentOf<typeof ProjectFields>): Project {
  const node = readFragment(ProjectFields, data);
  const total = last(node.issueCountHistory);
  return {
    id: node.id,
    teams: node.teams.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })),
    name: node.name,
    description: node.description,
    content: node.content ?? '',
    status: node.status.type as ProjectStatus,
    statusId: node.status.id,
    leadUserId: node.lead?.id ?? null,
    priority: node.priority,
    startDate: node.startDate ?? null,
    targetDate: node.targetDate ?? null,
    sortOrder: node.sortOrder,
    slugId: node.slugId,
    archivedAt: node.archivedAt ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    labelIds: node.labelIds,
    progress: {
      completed: last(node.completedIssueCountHistory),
      canceled: Math.max(0, total - node.scope),
      total,
    },
    health: (node.health ?? null) as ProjectHealth | null,
    scope: node.scope,
  };
}

const ProjectsPageQuery = graphql(
  `
    query ProjectsPage($filter: ProjectFilter, $first: Int!, $after: String) {
      projects(filter: $filter, first: $first, after: $after) {
        nodes {
          ...ProjectFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [ProjectFields],
);

// One page of the visible projects matching the filters, newest first, and the
// cursor of the next page.
export async function fetchProjectsPage(
  filters: ProjectListFilters,
  first: number,
  after: string | null = null,
) {
  const data = await gqlRequest(ProjectsPageQuery, {
    filter: toProjectFilter(filters),
    first,
    after,
  });
  return {
    items: data.projects.nodes.map(toProject),
    endCursor: data.projects.pageInfo.hasNextPage
      ? (data.projects.pageInfo.endCursor ?? null)
      : null,
  };
}

// The first page of the visible projects of one team (or every team when teamKey is
// null) for the pickers; keepPreviousData holds the options while a search loads.
export function useProjectsQuery(
  teamKey: string | null,
  params: { statuses?: ProjectStatus[]; search?: string; pageSize?: number } = {},
) {
  const { statuses, search, pageSize = 50 } = params;
  return useQuery({
    queryKey: qk.projects(teamKey ?? '', { statuses, search, pageSize }),
    queryFn: () => fetchProjectsPage({ teamKey, statuses, search }, pageSize),
    enabled: teamKey != null,
    placeholderData: keepPreviousData,
  });
}

const ProjectQuery = graphql(
  `
    query Project($id: String!) {
      project(id: $id) {
        ...ProjectFields
        members(first: 250) {
          nodes {
            id
            name
            avatarUrl
          }
        }
        projectMilestones {
          nodes {
            id
            name
            description
            targetDate
            sortOrder
          }
        }
        projectUpdates(first: 1) {
          nodes {
            id
            body
            health
            createdAt
            user {
              id
              name
            }
          }
        }
      }
    }
  `,
  [ProjectFields],
);

// A project's latest update, shown on the overview.
export interface ProjectLatestUpdate {
  id: string;
  body: string;
  health: ProjectHealth;
  createdAt: string;
  user: { id: string; name: string } | null;
}

// A project member: a user who can see the project (Linear's Project.members).
export interface ProjectMember {
  id: string;
  name: string;
  image: string | null;
}

export type ProjectDetail = Project & {
  members: ProjectMember[];
  milestones: ProjectMilestone[];
  latestUpdate: ProjectLatestUpdate | null;
};

async function fetchProject(id: string): Promise<ProjectDetail> {
  const { project } = await gqlRequest(ProjectQuery, { id });
  const update = project.projectUpdates.nodes[0];
  const base = toProject(project);
  return {
    ...base,
    members: project.members.nodes.map((m) => ({
      id: m.id,
      name: m.name,
      image: m.avatarUrl ?? null,
    })),
    milestones: project.projectMilestones.nodes.map((m) => ({
      id: m.id,
      projectId: base.id,
      name: m.name,
      description: m.description ?? '',
      targetDate: m.targetDate ?? null,
      sortOrder: m.sortOrder,
    })),
    latestUpdate: update
      ? {
          id: update.id,
          body: update.body,
          health: update.health as ProjectHealth,
          createdAt: update.createdAt,
          user: update.user ? { id: update.user.id, name: update.user.name } : null,
        }
      : null,
  };
}

export function useProjectQuery(id: string | null) {
  return useQuery({
    queryKey: qk.project(id ?? ''),
    queryFn: () => fetchProject(id!),
    enabled: id != null,
  });
}

// A project's milestones in Linear's order, read from the project.
export function useProjectMilestonesQuery(projectId: string | null) {
  const query = useProjectQuery(projectId);
  return {
    ...query,
    data: query.data
      ? [...query.data.milestones].sort((a, b) => a.sortOrder - b.sortOrder)
      : undefined,
  };
}

const ProjectStatusesQuery = graphql(`
  query ProjectStatuses {
    projectStatuses {
      nodes {
        id
        type
      }
    }
  }
`);

// The six fixed project statuses; a status change sends the status's id.
function fetchStatusIds(qc: QueryClient) {
  return qc.fetchQuery({
    queryKey: ['projectStatuses'],
    queryFn: async () => {
      const { projectStatuses } = await gqlRequest(ProjectStatusesQuery);
      return new Map(projectStatuses.nodes.map((s) => [s.type as ProjectStatus, s.id]));
    },
    staleTime: Infinity,
  });
}

const ProjectCreateMutation = graphql(`
  mutation ProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
      success
      project {
        id
      }
    }
  }
`);

const ProjectUpdateMutation = graphql(`
  mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const ProjectDeleteMutation = graphql(`
  mutation ProjectDelete($id: String!) {
    projectDelete(id: $id) {
      success
    }
  }
`);

export type { ProjectChange };

// The Linear input for a change, with the status's id looked up when it changes.
async function projectInput(qc: QueryClient, change: ProjectChange) {
  const statusIds = change.status !== undefined ? await fetchStatusIds(qc) : new Map();
  return toProjectInput(change, statusIds);
}

// Every query that shows a project: the detail, the lists and their counts, and the
// team scaffold (project names on issues).
export function invalidateProject(qc: QueryClient, id: string, teamKey?: string) {
  void qc.invalidateQueries({ queryKey: qk.project(id) });
  void qc.invalidateQueries({ queryKey: qk.projectActivity(id) });
  void qc.invalidateQueries({ queryKey: qk.anyProjects });
  void qc.invalidateQueries({ queryKey: ['projectCounts'] });
  if (teamKey) void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
}

// Creates a project on its teams and returns its id.
export function useCreateProject(teamKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (change: ProjectChange & { name: string; teamIds: string[] }) => {
      const input = await projectInput(qc, change);
      const { projectCreate } = await gqlRequest(ProjectCreateMutation, {
        input: { ...input, name: change.name, teamIds: change.teamIds },
      });
      if (!projectCreate.project) throw new Error('The project was not created.');
      return { id: projectCreate.project.id };
    },
    onSuccess: ({ id }) => invalidateProject(qc, id, teamKey),
  });
}

// Patches the project's cached detail at once (so a picker that stays open builds
// each pick on the last), rolls back on error and refetches when the last pending
// update settles. `members` carries the people behind added memberIds.
export function useUpdateProject(teamKey?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['updateProject'],
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: ProjectChange;
      members?: ProjectMember[];
    }) => {
      await gqlRequest(ProjectUpdateMutation, { id, input: await projectInput(qc, patch) });
    },
    onMutate: async ({ id, patch, members }) => {
      await qc.cancelQueries({ queryKey: qk.project(id) });
      const previous = qc.getQueryData<ProjectDetail>(qk.project(id));
      if (previous) qc.setQueryData(qk.project(id), patchProject(previous, patch, members));
      return { previous };
    },
    onError: (_err, { id }, context) => {
      if (context?.previous) qc.setQueryData(qk.project(id), context.previous);
    },
    onSettled: (_data, _err, { id }) => {
      if (qc.isMutating({ mutationKey: ['updateProject'] }) <= 1)
        invalidateProject(qc, id, teamKey);
    },
  });
}

// Deleting a project unlinks its issues, so the team's board issues change too, and
// removes it from the initiatives it was linked to.
export function useDeleteProject(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => gqlRequest(ProjectDeleteMutation, { id }),
    onSuccess: (_data, id) => {
      invalidateProject(qc, id, teamKey);
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.initiatives });
      void qc.invalidateQueries({ queryKey: ['initiative'] });
    },
  });
}

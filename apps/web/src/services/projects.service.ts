import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  api,
  type FeedCursor,
  type Project,
  type ProjectHealth,
  type ProjectMilestone,
  type ProjectPatch,
  type ProjectStatus,
  type NewProjectInput,
} from '@/lib/api';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
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
        members {
          nodes {
            id
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

export type ProjectDetail = Project & {
  memberIds: string[];
  milestones: ProjectMilestone[];
  latestUpdate: ProjectLatestUpdate | null;
};

async function fetchProject(id: string): Promise<ProjectDetail> {
  const { project } = await gqlRequest(ProjectQuery, { id });
  const update = project.projectUpdates.nodes[0];
  const base = toProject(project);
  return {
    ...base,
    memberIds: project.members.nodes.map((m) => m.id),
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

export function useProjectLabelsQuery() {
  return useQuery({ queryKey: ['project-labels'], queryFn: () => api.listProjectLabels() });
}

// Creates, updates or deletes a project label, then refreshes the label list.
export function useProjectLabelMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['project-labels'] });
  return {
    create: useMutation({
      mutationFn: (input: { name: string; color?: string }) => api.createProjectLabel(input),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: { name?: string; color?: string } }) =>
        api.updateProjectLabel(id, patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteProjectLabel(id),
      onSuccess: refresh,
    }),
  };
}

// Replaces the project's teams (the ones the viewer can see).
export function useSetProjectTeams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, teamIds }: { id: string; teamIds: string[] }) =>
      api.setProjectTeams(id, teamIds),
    onSuccess: (_project, { id }) => {
      qc.invalidateQueries({ queryKey: qk.project(id) });
      qc.invalidateQueries({ queryKey: qk.anyProjects });
      qc.invalidateQueries({ queryKey: ['projectCounts'] });
    },
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProjectInput & { teamIds: string[] }) => api.createProject(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['projectCounts'] });
      qc.invalidateQueries({ queryKey: ['workItems'] });
    },
  });
}

export function useUpdateProject(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProjectPatch }) =>
      api.updateProject(id, patch),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: qk.anyProjects });
      qc.invalidateQueries({ queryKey: ['projectCounts'] });
      qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      qc.invalidateQueries({ queryKey: qk.project(id) });
      qc.invalidateQueries({ queryKey: qk.projectFeed(id) });
    },
  });
}

export function useDeleteProject(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: qk.anyProjects });
      qc.invalidateQueries({ queryKey: ['projectCounts'] });
      qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      // Deleting an project unlinks its issues (projectId -> null), so the
      // board issues change too.
      qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
      qc.invalidateQueries({ queryKey: qk.project(id) });
    },
  });
}

// The project's feed (its own events plus its linked issues' activity), paged
// newest first. Each page is 25 items; getNextPageParam yields the server's cursor
// until it returns null.
export function useProjectFeedQuery(id: string | null) {
  return useInfiniteQuery({
    queryKey: qk.projectFeed(id ?? ''),
    queryFn: ({ pageParam }) => api.listProjectFeed(id!, { cursor: pageParam, limit: 25 }),
    initialPageParam: null as FeedCursor | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: id != null,
  });
}

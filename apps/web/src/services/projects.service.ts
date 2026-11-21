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
  type ProjectListParams,
  type ProjectPatch,
  type NewProjectInput,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';

// A page of the visible projects, of one team when teamKey is given. params filter
// (status/search), sort and page it server-side; keepPreviousData holds the
// current page on screen while the next one loads.
export function useProjectsQuery(teamKey: string | null, params: ProjectListParams = {}) {
  return useQuery({
    queryKey: qk.projects(teamKey ?? '', params as Record<string, unknown>),
    queryFn: () => api.listProjects(teamKey, params),
    placeholderData: keepPreviousData,
  });
}

// Per-status counts for the list's status tabs, independent of the current page.
export function useProjectCountsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.projectCounts(teamKey ?? ''),
    queryFn: () => api.projectCounts(teamKey),
  });
}

export function useProjectMilestonesQuery(projectId: string | null) {
  return useQuery({
    queryKey: ['project-milestones', projectId ?? ''],
    queryFn: () => api.listProjectMilestones(projectId!),
    enabled: projectId != null,
  });
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
    onSuccess: (project) => {
      qc.setQueryData(qk.project(project.id), project);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useProjectQuery(id: string | null) {
  return useQuery({
    queryKey: qk.project(id ?? ''),
    queryFn: () => api.getProject(id!),
    enabled: id != null,
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
      qc.invalidateQueries({ queryKey: qk.projectsForTeam(teamKey) });
      qc.invalidateQueries({ queryKey: qk.projectCounts(teamKey) });
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
      qc.invalidateQueries({ queryKey: qk.projectsForTeam(teamKey) });
      qc.invalidateQueries({ queryKey: qk.projectCounts(teamKey) });
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

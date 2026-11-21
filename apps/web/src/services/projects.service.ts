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
import { useTeamQuery } from '@/services/teams.service';

// A page of the team's projects. params filter (status/search), sort and
// page it server-side; keepPreviousData holds the current page on screen while the
// next one loads. Omit params to load the default first page.
export function useProjectsQuery(teamKey: string | null, params: ProjectListParams = {}) {
  return useQuery({
    queryKey: qk.projects(teamKey ?? '', params as Record<string, unknown>),
    queryFn: () => api.listProjects(teamKey!, params),
    enabled: teamKey != null,
    placeholderData: keepPreviousData,
  });
}

// Per-status counts for the list's status tabs, independent of the current page.
export function useProjectCountsQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.projectCounts(teamKey ?? ''),
    queryFn: () => api.projectCounts(teamKey!),
    enabled: teamKey != null,
  });
}

export function useProjectQuery(id: string | null) {
  return useQuery({
    queryKey: qk.project(id ?? ''),
    queryFn: () => api.getProject(id!),
    enabled: id != null,
  });
}

export function useCreateProject(teamKey: string) {
  const qc = useQueryClient();
  const team = useTeamQuery(teamKey).data;
  return useMutation({
    mutationFn: (input: NewProjectInput) =>
      api.createProject({ teamIds: team ? [team.team.id] : [], ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.projectsForTeam(teamKey) });
      qc.invalidateQueries({ queryKey: qk.projectCounts(teamKey) });
      qc.invalidateQueries({ queryKey: qk.team(teamKey) });
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

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Project, ProjectCounts, ProjectStatus } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { fetchProjectsPage } from '@/services/projects.service';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { toProjectFilter, type ProjectListFilters } from '@/utils/projectFilter';
import { appendPage, sumStatusCounts } from '../utils/projectList';

const PAGE_SIZE = 25;

// The projects list: pages of 25 in the server's order (newest first), each "Load
// more" appended by cursor. appendPage drops a row a later page repeats.
export function useProjectsList(filters: ProjectListFilters) {
  const query = useInfiniteQuery({
    queryKey: qk.projects(filters.teamKey ?? '', {
      list: true,
      statuses: filters.statuses,
      search: filters.search,
    }),
    queryFn: ({ pageParam }) => fetchProjectsPage(filters, PAGE_SIZE, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.endCursor,
  });
  const items: Project[] = (query.data?.pages ?? []).reduce<Project[]>(
    (all, page) => appendPage(all, page.items),
    [],
  );
  return { ...query, items };
}

const ProjectIdsQuery = graphql(`
  query ProjectIds($filter: ProjectFilter, $first: Int!, $after: String) {
    projects(filter: $filter, first: $first, after: $after) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const STATUSES: ProjectStatus[] = [
  'backlog',
  'planned',
  'started',
  'paused',
  'completed',
  'canceled',
];

async function countProjects(teamKey: string | null, status: ProjectStatus): Promise<number> {
  const ids = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(ProjectIdsQuery, {
      filter: toProjectFilter({ teamKey, statuses: [status] }),
      first,
      after,
    });
    return data.projects;
  });
  return ids.length;
}

// The status tab counts. Linear's project connection has no total, so each status
// pages through the matching ids (250 per request) and counts them.
export function useProjectStatusCounts(teamKey: string | null) {
  return useQuery<ProjectCounts>({
    queryKey: qk.projectCounts(teamKey ?? ''),
    queryFn: async () => {
      const counts = await Promise.all(STATUSES.map((status) => countProjects(teamKey, status)));
      return sumStatusCounts(Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]])));
    },
  });
}

import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { toProjectFilter, type ProjectListFilters } from '@/utils/projectFilter';
import type { ProjectStatus, ProjectHealth } from '@/types/project';
import type { ProjectDates, TimelineProject } from '../utils/projectTimeline';

const TimelineProjectsQuery = graphql(`
  query TimelineProjects($filter: ProjectFilter, $first: Int!, $after: String) {
    projects(filter: $filter, first: $first, after: $after) {
      nodes {
        id
        name
        startDate
        targetDate
        health
        status {
          type
        }
        lead {
          id
        }
        teams {
          nodes {
            id
            name
          }
        }
        initiatives {
          nodes {
            id
            name
          }
        }
        projectMilestones {
          nodes {
            id
            name
            targetDate
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const ProjectDatesUpdate = graphql(`
  mutation TimelineProjectDates($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
      success
    }
  }
`);

const MilestoneDateUpdate = graphql(`
  mutation TimelineMilestoneDate($id: String!, $input: ProjectMilestoneUpdateInput!) {
    projectMilestoneUpdate(id: $id, input: $input) {
      success
    }
  }
`);

export const timelineProjectsKey = (filters: ProjectListFilters): QueryKey =>
  qk.projects(filters.teamKey ?? '', {
    timeline: true,
    statuses: filters.statuses,
    search: filters.search,
  });

// Every project matching the tab, team filter and search (no paging: the timeline
// shows them all), with what the timeline draws and groups by.
export function useTimelineProjects(filters: ProjectListFilters, enabled: boolean) {
  return useQuery({
    queryKey: timelineProjectsKey(filters),
    queryFn: async (): Promise<TimelineProject[]> => {
      const nodes = await fetchAllPages(async (after, first) => {
        const data = await gqlRequest(TimelineProjectsQuery, {
          filter: toProjectFilter(filters),
          first,
          after,
        });
        return data.projects;
      });
      return nodes.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status.type as ProjectStatus,
        health: (p.health as ProjectHealth | null) ?? null,
        startDate: p.startDate ?? null,
        targetDate: p.targetDate ?? null,
        leadUserId: p.lead?.id ?? null,
        teams: p.teams.nodes.map((t) => ({ id: t.id, name: t.name })),
        initiatives: p.initiatives.nodes.map((i) => ({ id: i.id, name: i.name })),
        milestones: p.projectMilestones.nodes.map((m) => ({
          id: m.id,
          name: m.name,
          targetDate: m.targetDate ?? null,
        })),
      }));
    },
    enabled,
  });
}

type DateWrite =
  | { kind: 'project'; projectId: string; dates: ProjectDates }
  | { kind: 'milestone'; projectId: string; milestoneId: string; targetDate: string };

function patchTimeline(list: TimelineProject[], write: DateWrite): TimelineProject[] {
  return list.map((p) => {
    if (p.id !== write.projectId) return p;
    if (write.kind === 'project') return { ...p, ...write.dates };
    return {
      ...p,
      milestones: p.milestones.map((m) =>
        m.id === write.milestoneId ? { ...m, targetDate: write.targetDate } : m,
      ),
    };
  });
}

// A dragged bar or milestone: the timeline shows the new dates at once, rolls back
// and shows the error when the change fails, and every project list (the table, the
// tab counts, the dependency warnings) refreshes once it settles.
export function useTimelineDateWrite(key: QueryKey) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (write: DateWrite) => {
      if (write.kind === 'project')
        await gqlRequest(ProjectDatesUpdate, { id: write.projectId, input: write.dates });
      else
        await gqlRequest(MilestoneDateUpdate, {
          id: write.milestoneId,
          input: { targetDate: write.targetDate },
        });
    },
    onMutate: async (write) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<TimelineProject[]>(key);
      if (previous) qc.setQueryData(key, patchTimeline(previous, write));
      return { previous };
    },
    onError: (err, _write, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
      toast.error(err instanceof Error ? err.message : 'The dates were not changed');
    },
    onSettled: (_data, _err, write) => {
      void qc.invalidateQueries({ queryKey: qk.anyProjects });
      void qc.invalidateQueries({ queryKey: qk.project(write.projectId) });
    },
  });
}

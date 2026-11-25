import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import {
  emptyNames,
  fetchInsightIssues,
  InsightIssueFields,
  toInsightIssue,
} from '@/services/insightIssues.service';
import type { WidgetRows } from '@/utils/dashboards/compute';
import type { ProjectHealth } from '@/utils/dashboards/config';
import type { CycleRow } from '@/utils/dashboards/cycleMeasures';
import type { RequestRow, RequestSource } from '@/utils/dashboards/feedbackMeasures';
import { DASHBOARD_ROW_LIMIT, pagedLoad, type LoadSpec } from '@/utils/dashboards/loads';
import type { ProjectRow } from '@/utils/dashboards/projectMeasures';
import { EMPTY_CONTEXT } from '@/utils/insights/context';
import type { InsightsContext } from '@/utils/insights/slices';

// The rows a dashboard widget's load asks for (utils/dashboards/loads.ts), through
// Linear's API as the viewer, so a widget only ever holds what the viewer may read.

export interface LoadedRows extends WidgetRows {
  capped: boolean;
  // The names of the states, people, labels, cycles and teams on the loaded issues.
  names: InsightsContext;
}

const RequestsPage = graphql(
  `
    query DashboardRequests($filter: CustomerNeedFilter, $after: String, $first: Int) {
      customerNeeds(filter: $filter, first: $first, after: $after) {
        nodes {
          id
          createdAt
          priority
          attachment {
            metadata
            externalUserCreator {
              id
            }
          }
          issue {
            ...InsightIssueFields
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [InsightIssueFields],
);

const ProjectsPage = graphql(`
  query DashboardProjects($after: String, $first: Int) {
    projects(first: $first, after: $after) {
      nodes {
        id
        name
        progress
        targetDate
        health
        status {
          type
        }
        lead {
          id
          displayName
        }
        teams {
          nodes {
            id
          }
        }
        labels {
          nodes {
            id
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

const CyclesPage = graphql(`
  query DashboardCycles($filter: CycleFilter, $after: String, $first: Int) {
    cycles(filter: $filter, first: $first, after: $after, includeArchived: true) {
      nodes {
        id
        number
        name
        startsAt
        endsAt
        completedAt
        progress
        scopeHistory
        completedScopeHistory
        issueCountHistory
        team {
          id
          key
        }
        uncompletedIssuesUponClose(first: 250) {
          nodes {
            id
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

const SOURCES: RequestSource[] = ['team', 'portal', 'form'];

// The feedback attachment records where the request came from (project 1); older
// feedback without it was logged by the team.
function sourceOf(metadata: unknown): RequestSource {
  const source = (metadata as { source?: unknown } | null)?.source;
  return SOURCES.includes(source as RequestSource) ? (source as RequestSource) : 'team';
}

const HEALTH: ProjectHealth[] = ['onTrack', 'atRisk', 'offTrack'];

// The auth client's JSON reader turns ISO timestamps into Date objects.
function isoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : null;
}

const last = (history: readonly number[]): number => history[history.length - 1] ?? 0;

async function loadRequests(filter: Record<string, unknown>): Promise<LoadedRows> {
  const { nodes, capped } = await pagedLoad(async (after, first) => {
    const data = await gqlRequest(RequestsPage, { filter, after, first });
    return data.customerNeeds;
  });
  const names = emptyNames();
  // Every feedback item here is on an issue; Linear's type also allows project needs.
  const requests = nodes.flatMap((n): RequestRow[] =>
    n.issue
      ? [
          {
            id: n.id,
            createdAt: n.createdAt,
            important: n.priority >= 1,
            source: sourceOf(n.attachment?.metadata),
            requesterId: n.attachment?.externalUserCreator?.id ?? null,
            issue: toInsightIssue(n.issue, names),
          },
        ]
      : [],
  );
  return { requests, names, capped };
}

async function loadProjects(): Promise<LoadedRows> {
  const { nodes, capped } = await pagedLoad(async (after, first) => {
    const data = await gqlRequest(ProjectsPage, { after, first });
    return data.projects;
  });
  const projects = nodes.map((p): ProjectRow => ({
    id: p.id,
    name: p.name,
    status: p.status.type,
    leadId: p.lead?.id ?? null,
    leadName: p.lead?.displayName ?? null,
    teamIds: p.teams.nodes.map((t) => t.id),
    labelIds: p.labels.nodes.map((l) => l.id),
    health: HEALTH.includes(p.health as ProjectHealth) ? (p.health as ProjectHealth) : null,
    progress: p.progress,
    targetDate: p.targetDate ?? null,
  }));
  return { projects, names: EMPTY_CONTEXT, capped };
}

async function loadCycles(filter: Record<string, unknown>): Promise<LoadedRows> {
  const { nodes, capped } = await pagedLoad(async (after, first) => {
    const data = await gqlRequest(CyclesPage, { filter, after, first });
    return data.cycles;
  });
  const cycles = nodes.map((c): CycleRow => ({
    id: c.id,
    teamId: c.team.id,
    teamKey: c.team.key,
    number: c.number,
    name: c.name ?? null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    completedAt: c.completedAt ?? null,
    // The cycles' scope rule counts points as soon as an issue is estimated; scope
    // then differs from the issue count on some day.
    unit: c.scopeHistory.some((v, i) => v !== c.issueCountHistory[i]) ? 'points' : 'issues',
    scope: last(c.scopeHistory),
    completedScope: last(c.completedScopeHistory),
    carriedOver: c.uncompletedIssuesUponClose.nodes.length,
    progress: c.progress,
  }));
  return { cycles, names: EMPTY_CONTEXT, capped };
}

export async function loadRows(spec: LoadSpec): Promise<LoadedRows> {
  switch (spec.data) {
    case 'issues': {
      const { issues, names, capped } = await fetchInsightIssues(spec.filter, DASHBOARD_ROW_LIMIT);
      return { issues, names, capped };
    }
    case 'requests':
      return loadRequests(spec.filter);
    case 'projects':
      return loadProjects();
    case 'cycles':
      return loadCycles(spec.filter);
    case 'none':
      return {
        issues: [],
        requests: [],
        projects: [],
        cycles: [],
        names: EMPTY_CONTEXT,
        capped: false,
      };
  }
}

interface RequesterPage {
  requesters: { id: string; firstFeedbackAt: unknown }[];
  nextCursor: string | null;
}

// Each requester's first request ever, from the People list (instance endpoint), for
// the "new people" measure; at most the dashboard's row limit of people.
export async function loadFirstFeedback(): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    const page: RequesterPage = await instanceFetch<RequesterPage>(
      `/instance/requesters?${params.toString()}`,
    );
    for (const r of page.requesters) out.set(r.id, isoString(r.firstFeedbackAt));
    cursor = page.nextCursor;
  } while (cursor && out.size < DASHBOARD_ROW_LIMIT);
  return out;
}

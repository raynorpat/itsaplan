import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { fetchRequestSummaries } from '@/services/feedback.service';
import {
  emptyNames,
  fetchInsightIssues,
  InsightIssueFields,
  toInsightIssue,
} from '@/services/insightIssues.service';
import type { WidgetRows } from '@/utils/dashboards/compute';
import type { ProjectHealth } from '@/utils/dashboards/config';
import type { CustomerRow } from '@/utils/dashboards/customerMeasures';
import type { CycleRow } from '@/utils/dashboards/cycleMeasures';
import type { RequestRow, RequestSource } from '@/utils/dashboards/feedbackMeasures';
import { DASHBOARD_ROW_LIMIT, pagedLoad, type LoadSpec } from '@/utils/dashboards/loads';
import type { ProjectRow } from '@/utils/dashboards/projectMeasures';
import { EMPTY_CONTEXT } from '@/utils/insights/context';
import type { InsightsContext } from '@/utils/insights/slices';
import { withRequests } from '@/utils/requests';

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
      customerNeeds(filter: $filter, first: $first, after: $after, includeArchived: true) {
        nodes {
          id
          createdAt
          archivedAt
          priority
          attachment {
            metadata
            externalUserCreator {
              id
            }
          }
          customer {
            id
            name
            revenue
            status {
              id
              displayName
              position
            }
            tier {
              id
              displayName
              position
            }
          }
          issue {
            archivedAt
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

const CustomersPage = graphql(`
  query DashboardCustomers($after: String, $first: Int) {
    customers(first: $first, after: $after) {
      nodes {
        id
        slugId
        name
        revenue
        approximateNeedCount
        createdAt
        status {
          id
          displayName
          position
        }
        tier {
          id
          displayName
          position
        }
        owner {
          id
          displayName
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

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

// Per cycle only stored fields: the histories give the scope, the completed scope, the
// progress and the issues left unfinished at close, so the load costs no per-cycle
// issue lists. Running cycles' live progress comes from ActiveCyclesProgress.
export const CyclesPage = graphql(`
  query DashboardCycles($filter: CycleFilter, $after: String, $first: Int) {
    cycles(filter: $filter, first: $first, after: $after, includeArchived: true) {
      nodes {
        id
        number
        name
        startsAt
        endsAt
        completedAt
        scopeHistory
        completedScopeHistory
        inProgressScopeHistory
        issueCountHistory
        completedIssueCountHistory
        team {
          id
          key
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const ActiveCyclesProgress = graphql(`
  query DashboardActiveCycles($filter: CycleFilter, $first: Int) {
    cycles(filter: $filter, first: $first) {
      nodes {
        id
        progress
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

export interface CycleNode {
  id: string;
  number: number;
  name?: string | null;
  startsAt: string;
  endsAt: string;
  completedAt?: string | null;
  scopeHistory: number[];
  completedScopeHistory: number[];
  inProgressScopeHistory: number[];
  issueCountHistory: number[];
  completedIssueCountHistory: number[];
  team: { id: string; key: string };
}

// A cycle as a widget row. A closed cycle's last history day is its close: the issues
// in scope then but not completed are the ones moved on (canceled issues are not in
// scope). Progress follows the cycles' rule (started counts a quarter); a running
// cycle takes its live progress from `activeProgress`.
export function toCycleRow(c: CycleNode, activeProgress: Map<string, number>): CycleRow {
  const scope = last(c.scopeHistory);
  const completedScope = last(c.completedScopeHistory);
  const historyProgress = scope
    ? Math.min(1, (completedScope + 0.25 * last(c.inProgressScopeHistory)) / scope)
    : 0;
  return {
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
    scope,
    completedScope,
    carriedOver: c.completedAt
      ? Math.max(0, last(c.issueCountHistory) - last(c.completedIssueCountHistory))
      : 0,
    progress: activeProgress.get(c.id) ?? historyProgress,
  };
}

async function loadRequests(filter: Record<string, unknown>): Promise<LoadedRows> {
  const { nodes, capped } = await pagedLoad(async (after, first) => {
    const data = await gqlRequest(RequestsPage, { filter, after, first });
    return data.customerNeeds;
  });
  const names = emptyNames();
  // Every feedback item here is on an issue; Linear's type also allows project needs.
  // Archived requests are listed too (includeArchived also brings requests on archived
  // issues); only active ones count.
  const requests = nodes.flatMap((n): RequestRow[] =>
    n.issue && !n.archivedAt
      ? [
          {
            id: n.id,
            createdAt: n.createdAt,
            important: n.priority >= 1,
            source: sourceOf(n.attachment?.metadata),
            requesterId: n.attachment?.externalUserCreator?.id ?? null,
            customer: n.customer
              ? {
                  id: n.customer.id,
                  name: n.customer.name,
                  revenue: n.customer.revenue ?? null,
                  status: {
                    id: n.customer.status.id,
                    name: n.customer.status.displayName,
                    position: n.customer.status.position,
                  },
                  tier: n.customer.tier
                    ? {
                        id: n.customer.tier.id,
                        name: n.customer.tier.displayName,
                        position: n.customer.tier.position,
                      }
                    : null,
                }
              : null,
            issueArchived: n.issue.archivedAt != null,
            issue: toInsightIssue(n.issue, names),
          },
        ]
      : [],
  );
  return { requests, names, capped };
}

async function loadCustomers(): Promise<LoadedRows> {
  const { nodes, capped } = await pagedLoad(async (after, first) => {
    const data = await gqlRequest(CustomersPage, { after, first });
    return data.customers;
  });
  const customers = nodes.map((c): CustomerRow => ({
    id: c.id,
    slugId: c.slugId,
    name: c.name,
    statusId: c.status.id,
    statusName: c.status.displayName,
    statusPosition: c.status.position,
    tierId: c.tier?.id ?? null,
    tierName: c.tier?.displayName ?? null,
    tierPosition: c.tier?.position ?? null,
    ownerId: c.owner?.id ?? null,
    ownerName: c.owner?.displayName ?? null,
    revenue: c.revenue ?? null,
    requests: c.approximateNeedCount,
    createdAt: isoString(c.createdAt) ?? '',
  }));
  return { customers, names: EMPTY_CONTEXT, capped };
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
  const teamPart = Array.isArray(filter.and)
    ? (filter.and as Record<string, unknown>[]).find((f) => 'team' in f)
    : 'team' in filter
      ? filter
      : undefined;
  const active = await gqlRequest(ActiveCyclesProgress, {
    filter: { ...(teamPart ?? {}), isActive: { eq: true } },
    first: 250,
  });
  const progress = new Map(active.cycles.nodes.map((c) => [c.id, c.progress]));
  return { cycles: nodes.map((c) => toCycleRow(c, progress)), names: EMPTY_CONTEXT, capped };
}

export async function loadRows(spec: LoadSpec): Promise<LoadedRows> {
  switch (spec.data) {
    case 'issues': {
      const [{ issues, names, capped }, summaries] = await Promise.all([
        fetchInsightIssues(spec.filter, DASHBOARD_ROW_LIMIT),
        spec.requests
          ? fetchRequestSummaries(spec.filter, { includeArchived: true })
          : Promise.resolve(undefined),
      ]);
      return { issues: withRequests(issues, summaries), names, capped };
    }
    case 'requests':
      return loadRequests(spec.filter);
    case 'projects':
      return loadProjects();
    case 'customers':
      return loadCustomers();
    case 'cycles':
      return loadCycles(spec.filter);
    case 'none':
      return {
        issues: [],
        requests: [],
        projects: [],
        cycles: [],
        customers: [],
        names: EMPTY_CONTEXT,
        capped: false,
      };
  }
}

interface FirstRequests {
  people: { id: string; firstFeedbackAt: unknown }[];
}

export function firstFeedbackMap(people: FirstRequests['people']): Map<string, string | null> {
  return new Map(people.map((p) => [p.id, isoString(p.firstFeedbackAt)]));
}

// The people whose first request ever is at or after `since` (the previous period's
// start), with that date, for the "new people" measure: one request, ids and dates only.
// A person missing from the map had their first request earlier.
export async function loadFirstFeedback(since: string): Promise<Map<string, string | null>> {
  const params = new URLSearchParams({ since });
  const res = await instanceFetch<FirstRequests>(`/instance/feedback/first-requests?${params}`);
  return firstFeedbackMap(res.people);
}

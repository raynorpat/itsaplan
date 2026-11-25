import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { cycleLabel } from '@/utils/cycles';
import { fetchPagesUpTo } from '@/utils/fetchAllPages';
import type { InsightIssue, InsightsContext } from '@/utils/insights/slices';
import type { IssueFilter } from '@/utils/viewFilters';
import type { EstimationType, TeamEstimateSettings } from '@/utils/estimates';
import { withTeamEstimate } from '@/utils/insights/measures';

// The issues the Insights panel and dashboard widgets fetch, with only the fields they
// read and the names they show. Archived issues are included: auto-archive moves old
// completed issues out of the board, and they still count for cycle and lead time.

export const INSIGHTS_ISSUE_LIMIT = 5000;

export const InsightIssueFields = graphql(`
  fragment InsightIssueFields on Issue {
    id
    identifier
    title
    priority
    estimate
    startedAt
    completedAt
    canceledAt
    createdAt
    team {
      id
      name
      issueEstimationType
      issueEstimationExtended
      issueEstimationAllowZero
      defaultIssueEstimate
    }
    state {
      id
      name
      type
      position
      color
    }
    assignee {
      id
      displayName
    }
    creator {
      id
      displayName
    }
    project {
      id
      name
      archivedAt
    }
    cycle {
      id
      number
      name
    }
    labels {
      nodes {
        id
        name
      }
    }
  }
`);

const InsightIssuesPage = graphql(
  `
    query InsightIssues($filter: IssueFilter, $after: String, $first: Int) {
      issues(
        filter: $filter
        first: $first
        after: $after
        includeArchived: true
        orderBy: updatedAt
      ) {
        nodes {
          ...InsightIssueFields
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

export interface InsightsFetch {
  issues: InsightIssue[];
  // The names of the states, people, labels, cycles and teams on the fetched issues.
  names: InsightsContext;
  capped: boolean;
}

export function emptyNames(): {
  states: Map<string, { name: string; type: string; position: number; color?: string }>;
  users: Map<string, string>;
  labels: Map<string, string>;
  cycles: Map<string, string>;
  teams: Map<string, string>;
  teamEstimates: Map<string, TeamEstimateSettings>;
} {
  return {
    states: new Map(),
    users: new Map(),
    labels: new Map(),
    cycles: new Map(),
    teams: new Map(),
    teamEstimates: new Map(),
  };
}

export async function fetchInsightIssues(
  filter: IssueFilter,
  limit: number,
): Promise<InsightsFetch> {
  const { nodes, capped } = await fetchPagesUpTo(async (after, first) => {
    const data = await gqlRequest(InsightIssuesPage, { filter, after, first });
    return data.issues;
  }, limit);
  const names = emptyNames();
  const issues = nodes.map((data) => toInsightIssue(data, names));
  return { issues, names, capped };
}

export type InsightNames = ReturnType<typeof emptyNames>;

// One fetched issue in the Insights shape; its names are added to `names`.
export function toInsightIssue(
  data: FragmentOf<typeof InsightIssueFields>,
  names: InsightNames,
): InsightIssue {
  const n = readFragment(InsightIssueFields, data);
  names.teams.set(n.team.id, n.team.name);
  const estimates: TeamEstimateSettings = {
    type: n.team.issueEstimationType as EstimationType,
    extended: n.team.issueEstimationExtended,
    allowZero: n.team.issueEstimationAllowZero,
    defaultEstimate: n.team.defaultIssueEstimate,
  };
  names.teamEstimates.set(n.team.id, estimates);
  names.states.set(n.state.id, {
    name: n.state.name,
    type: n.state.type,
    position: n.state.position,
    color: n.state.color,
  });
  if (n.assignee) names.users.set(n.assignee.id, n.assignee.displayName);
  if (n.creator) names.users.set(n.creator.id, n.creator.displayName);
  if (n.cycle) names.cycles.set(n.cycle.id, cycleLabel(n.cycle));
  for (const l of n.labels.nodes) names.labels.set(l.id, l.name);
  return withTeamEstimate(
    {
      id: n.id,
      teamId: n.team.id,
      identifier: n.identifier,
      title: n.title,
      stateId: n.state.id,
      assigneeUserId: n.assignee?.id ?? null,
      creatorUserId: n.creator?.id ?? null,
      priority: n.priority,
      estimate: n.estimate ?? null,
      labelIds: n.labels.nodes.map((l) => l.id),
      project: n.project
        ? { id: n.project.id, title: n.project.name, deleted: n.project.archivedAt != null }
        : null,
      cycleId: n.cycle?.id ?? null,
      startedAt: n.startedAt ?? null,
      completedAt: n.completedAt ?? null,
      canceledAt: n.canceledAt ?? null,
      createdAt: n.createdAt,
    },
    estimates,
  );
}

import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { fetchPagesUpTo } from '@/utils/fetchAllPages';
import type { IssueFilter } from '@/utils/viewFilters';
import { cycleLabel } from '@/utils/cycles';
import { completedIssuesFilter } from '@/utils/insights/data';
import type { InsightIssue, InsightsContext } from '@/utils/insights/slices';

// The issues an Insights panel fetches, with only the fields it reads and the names
// it shows. Archived issues are included: auto-archive moves old completed issues out
// of the board, and they still count for cycle and lead time.

export const INSIGHTS_ISSUE_LIMIT = 5000;

const InsightIssueFields = graphql(`
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

function emptyNames(): {
  states: Map<string, { name: string; type: string; position: number; color?: string }>;
  users: Map<string, string>;
  labels: Map<string, string>;
  cycles: Map<string, string>;
  teams: Map<string, string>;
} {
  return {
    states: new Map(),
    users: new Map(),
    labels: new Map(),
    cycles: new Map(),
    teams: new Map(),
  };
}

async function fetchInsightIssues(filter: IssueFilter, limit: number): Promise<InsightsFetch> {
  const { nodes, capped } = await fetchPagesUpTo(async (after, first) => {
    const data = await gqlRequest(InsightIssuesPage, { filter, after, first });
    return data.issues;
  }, limit);
  const names = emptyNames();
  const issues = nodes.map((data: FragmentOf<typeof InsightIssueFields>): InsightIssue => {
    const n = readFragment(InsightIssueFields, data);
    names.teams.set(n.team.id, n.team.name);
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
    return {
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
    };
  });
  return { issues, names, capped };
}

// The issues of a view (`scope`, Linear's IssueFilter for the view) completed since
// `since`, at most INSIGHTS_ISSUE_LIMIT. Pages come most recently updated first (the
// API's closest order to "most recently completed"), so the cap drops the oldest.
export function fetchCompletedIssues(
  scope: IssueFilter,
  since: Date,
  showSubIssues: boolean,
): Promise<InsightsFetch> {
  return fetchInsightIssues(
    completedIssuesFilter(scope, since, showSubIssues),
    INSIGHTS_ISSUE_LIMIT,
  );
}

// The open issues of a view whose list does not hold them in a form the panel reads
// (My issues), at most INSIGHTS_ISSUE_LIMIT.
export function fetchOpenIssues(
  scope: IssueFilter,
  showSubIssues: boolean,
): Promise<InsightsFetch> {
  return fetchInsightIssues(
    {
      and: [
        scope,
        { state: { type: { nin: ['completed', 'canceled'] } } },
        ...(showSubIssues ? [] : [{ parent: { null: true } }]),
      ],
    },
    INSIGHTS_ISSUE_LIMIT,
  );
}

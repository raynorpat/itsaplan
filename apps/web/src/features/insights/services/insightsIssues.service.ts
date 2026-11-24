import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { fetchPagesUpTo } from '@/utils/fetchAllPages';
import type { IssueFilter } from '@/utils/viewFilters';
import type { InsightIssue } from '../utils/slices';

// The completed issues of the Insights period, with only the fields the panel reads.
// Archived issues are included: auto-archive moves old completed issues out of the
// board, and they still count for cycle and lead time.

export const INSIGHTS_ISSUE_LIMIT = 5000;

const InsightIssueFields = graphql(`
  fragment InsightIssueFields on Issue {
    id
    identifier
    title
    priority
    estimate
    labelIds
    startedAt
    completedAt
    canceledAt
    createdAt
    team {
      id
    }
    state {
      id
    }
    assignee {
      id
    }
    creator {
      id
    }
    project {
      id
      name
      archivedAt
    }
    cycle {
      id
    }
  }
`);

const InsightIssuesPage = graphql(
  `
    query InsightIssues($filter: IssueFilter, $after: String, $first: Int) {
      issues(filter: $filter, first: $first, after: $after, includeArchived: true) {
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

function toInsightIssue(data: FragmentOf<typeof InsightIssueFields>): InsightIssue {
  const n = readFragment(InsightIssueFields, data);
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
    labelIds: n.labelIds,
    project: n.project
      ? { id: n.project.id, title: n.project.name, deleted: n.project.archivedAt != null }
      : null,
    cycleId: n.cycle?.id ?? null,
    startedAt: n.startedAt ?? null,
    completedAt: n.completedAt ?? null,
    canceledAt: n.canceledAt ?? null,
    createdAt: n.createdAt,
  };
}

// The issues of a view (`scope`, Linear's IssueFilter for the view) completed since
// `since`, at most INSIGHTS_ISSUE_LIMIT.
export async function fetchCompletedIssues(
  scope: IssueFilter,
  since: Date,
): Promise<{ issues: InsightIssue[]; capped: boolean }> {
  const filter = { and: [scope, { completedAt: { gte: since.toISOString() } }] };
  const { nodes, capped } = await fetchPagesUpTo(async (after, first) => {
    const data = await gqlRequest(InsightIssuesPage, { filter, after, first });
    return data.issues;
  }, INSIGHTS_ISSUE_LIMIT);
  return { issues: nodes.map(toInsightIssue), capped };
}

import { useQuery } from '@tanstack/react-query';
import type {
  Assignee,
  Column,
  Cycle,
  Label,
  LabelGroup,
  Team,
  TeamCycleSettings,
  TeamScaffold,
} from '@/types/team';
import type { Issue } from '@/types/issue';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { IssueFields, toIssue } from '@/services/issues.service';
import { useChangedSince } from '@/hooks/useChangedSince';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { teamAccess } from '@/utils/members';

// The board over GraphQL: the team scaffold (states, labels, members, the viewer's
// access) and every active issue of the team. The board, table, calendar and
// timeline filter, group and sort these in the browser.

const ScaffoldQuery = graphql(`
  query BoardScaffold($id: String!) {
    viewer {
      id
      admin
      owner
      guest
    }
    team(id: $id) {
      id
      key
      name
      description
      visibility
      createdAt
      cyclesEnabled
      cycleDuration
      cycleStartDay
      cycleCooldownTime
      upcomingCycleCount
      cycleIssueAutoAssignStarted
      cycleIssueAutoAssignCompleted
      cycles(first: 50, filter: { isPast: { eq: false } }) {
        nodes {
          id
          number
          name
          startsAt
          endsAt
          completedAt
        }
      }
      states(first: 250) {
        nodes {
          id
          name
          type
          color
          description
          position
          archivedAt
        }
      }
    }
  }
`);

const TeamLabelsPage = graphql(`
  query BoardLabels($id: String!, $after: String, $first: Int) {
    team(id: $id) {
      labels(first: $first, after: $after, includeArchived: true) {
        nodes {
          id
          name
          color
          isGroup
          archivedAt
          team {
            id
          }
          parent {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const TeamMembershipsPage = graphql(`
  query BoardMemberships($id: String!, $after: String, $first: Int) {
    team(id: $id) {
      memberships(first: $first, after: $after) {
        nodes {
          owner
          user {
            id
            name
            email
            avatarUrl
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`);

const BoardIssuesPage = graphql(
  `
    query BoardIssues($filter: IssueFilter, $after: String, $first: Int) {
      issues(filter: $filter, first: $first, after: $after) {
        nodes {
          ...IssueFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [IssueFields],
);

export async function fetchTeamScaffold(teamKey: string): Promise<TeamScaffold> {
  const [{ viewer, team }, labelNodes, memberNodes] = await Promise.all([
    gqlRequest(ScaffoldQuery, { id: teamKey }),
    fetchAllPages(async (after, first) => {
      const data = await gqlRequest(TeamLabelsPage, { id: teamKey, after, first });
      return data.team.labels;
    }),
    fetchAllPages(async (after, first) => {
      const data = await gqlRequest(TeamMembershipsPage, { id: teamKey, after, first });
      return data.team.memberships;
    }),
  ]);
  const teamRow: Team = {
    id: team.id,
    key: team.key,
    name: team.name,
    description: team.description ?? '',
    visibility: team.visibility === 'private' ? 'private' : 'public',
    createdAt: team.createdAt,
  };
  const states: Column[] = team.states.nodes
    .map((s) => ({
      id: s.id,
      teamId: team.id,
      name: s.name,
      stateType: s.type as Column['stateType'],
      color: s.color,
      description: s.description ?? '',
      position: s.position,
      archivedAt: s.archivedAt ?? null,
    }))
    .sort((a, b) => a.position - b.position);
  const labels: Label[] = [];
  const labelGroups: LabelGroup[] = [];
  for (const l of labelNodes) {
    if (l.isGroup)
      labelGroups.push({ id: l.id, teamId: l.team?.id ?? null, name: l.name, color: l.color });
    else
      labels.push({
        id: l.id,
        teamId: l.team?.id ?? null,
        groupId: l.parent?.id ?? null,
        name: l.name,
        color: l.color,
        // The API serves a retired label as archived (with includeArchived); pickers
        // leave it out, settings list it as retired.
        retiredAt: l.archivedAt ?? null,
      });
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  labels.sort(byName);
  labelGroups.sort(byName);
  const assignees: Assignee[] = memberNodes
    .map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.avatarUrl ?? null,
    }))
    .sort(byName);
  const viewerAccess = teamAccess(
    viewer,
    memberNodes.map((m) => ({ userId: m.user.id, owner: m.owner })),
  );
  const cycles: TeamCycleSettings = {
    enabled: team.cyclesEnabled,
    duration: team.cycleDuration,
    startDay: team.cycleStartDay,
    cooldown: team.cycleCooldownTime,
    upcomingCount: team.upcomingCycleCount,
    autoAssignStarted: team.cycleIssueAutoAssignStarted,
    autoAssignCompleted: team.cycleIssueAutoAssignCompleted,
  };
  const teamCycles: Cycle[] = team.cycles.nodes.map((c) => ({
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    completedAt: c.completedAt ?? null,
  }));
  return {
    team: teamRow,
    cycles,
    teamCycles,
    states,
    labels,
    labelGroups,
    assignees,
    viewer: viewerAccess,
  };
}

// The board scaffold (states, labels, members, the viewer's access) for a team.
export function useTeamScaffold(teamKey: string | null) {
  return useQuery({
    queryKey: qk.team(teamKey ?? ''),
    queryFn: () => fetchTeamScaffold(teamKey!),
    enabled: teamKey != null,
  });
}

const teamFilter = (teamKey: string) => ({ team: { key: { eq: teamKey } } });

async function fetchIssues(filter: Record<string, unknown>): Promise<Issue[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(BoardIssuesPage, { filter, after, first });
    return data.issues;
  });
  return nodes.map(toIssue);
}

// Every active issue of a team, kept fresh by changed-since polling. The cache entry
// (qk.boardIssues) holds the issue list itself, which the board's writes patch.
export function useBoardIssues(teamKey: string | null) {
  return useChangedSince<Issue>({
    queryKey: qk.boardIssues(teamKey ?? ''),
    fetchAll: () => fetchIssues(teamFilter(teamKey!)),
    fetchChanged: (since) => fetchIssues({ ...teamFilter(teamKey!), updatedAt: { gt: since } }),
    getUpdatedAt: (issue) => issue.updatedAt,
    enabled: teamKey != null,
  });
}

const SubscribedIssueIdsPage = graphql(`
  query SubscribedIssueIds($filter: IssueFilter, $after: String, $first: Int) {
    issues(filter: $filter, first: $first, after: $after) {
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

// The ids of the team's issues that have one of `userIds` as a subscriber. Linear's
// Issue carries no subscriber ids, so the subscribers filter asks the server which
// issues match while the filter is active.
export async function fetchSubscribedIssueIds(
  teamKey: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(SubscribedIssueIdsPage, {
      filter: { ...teamFilter(teamKey), subscribers: { some: { id: { in: userIds } } } },
      after,
      first,
    });
    return data.issues;
  });
  return new Set(nodes.map((n) => n.id));
}

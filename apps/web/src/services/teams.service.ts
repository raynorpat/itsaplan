import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Team, TeamVisibility } from '@/types/team';
import { useSession } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { createMembership, removeTeamMember } from '@/services/members.service';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { needsTeamOwners, teamAccess } from '@/utils/members';

const TeamsPage = graphql(`
  query TeamsList($after: String, $first: Int) {
    viewer {
      id
      admin
      owner
      guest
    }
    teams(first: $first, after: $after) {
      nodes {
        id
        key
        name
        description
        visibility
        createdAt
        cyclesEnabled
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

// The viewer's own memberships: their exact role in every team they belong to.
const ViewerMembershipsPage = graphql(`
  query ViewerTeamMemberships($after: String, $first: Int) {
    viewer {
      teamMemberships(first: $first, after: $after) {
        nodes {
          owner
          team {
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

// A team's memberships, for the teams where the owners decide the manage right.
const TeamOwnersPage = graphql(`
  query TeamOwnerMemberships($id: String!, $after: String, $first: Int) {
    team(id: $id) {
      memberships(first: $first, after: $after) {
        nodes {
          owner
          user {
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

type TeamNode = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  visibility: string;
  createdAt: string;
  cyclesEnabled?: boolean;
};

function toTeam(node: TeamNode): Team {
  return {
    id: node.id,
    key: node.key,
    name: node.name,
    description: node.description ?? '',
    visibility: node.visibility === 'private' ? 'private' : 'public',
    createdAt: node.createdAt,
    cyclesEnabled: node.cyclesEnabled ?? false,
  };
}

// The memberships teamAccess needs for one team: all of them when its owners decide
// the manage right, otherwise only the viewer's own.
async function membershipsForAccess(
  viewer: { id: string; admin: boolean; owner: boolean; guest: boolean },
  teamId: string,
  own: { owner: boolean } | null,
): Promise<{ userId: string; owner: boolean }[]> {
  if (needsTeamOwners(viewer, own)) {
    const nodes = await fetchAllPages(async (after, first) => {
      const data = await gqlRequest(TeamOwnersPage, { id: teamId, after, first });
      return data.team.memberships;
    });
    return nodes.map((m) => ({ userId: m.user.id, owner: m.owner }));
  }
  if (own) return [{ userId: viewer.id, owner: own.owner }];
  return [];
}

// Every team the caller can see: joined teams plus public teams they have not joined
// (role null), by key. The caller's role comes from their own memberships; a team's
// owners are read in full only where they decide the manage right (needsTeamOwners).
// Pickers that add work to a team use this list.
async function fetchTeams(): Promise<Team[]> {
  let viewer: { id: string; admin: boolean; owner: boolean; guest: boolean } | null = null;
  const [nodes, mine] = await Promise.all([
    fetchAllPages(async (after, first) => {
      const data = await gqlRequest(TeamsPage, { after, first });
      viewer = data.viewer;
      return data.teams;
    }),
    fetchAllPages(async (after, first) => {
      const data = await gqlRequest(ViewerMembershipsPage, { after, first });
      return data.viewer.teamMemberships;
    }),
  ]);
  const me = viewer!;
  const myMembership = new Map(mine.map((m) => [m.team.id, { owner: m.owner }]));
  return Promise.all(
    nodes.map(async (node) => {
      const own = myMembership.get(node.id) ?? null;
      const access = teamAccess(me, await membershipsForAccess(me, node.id, own));
      return { ...toTeam(node), role: access.role, canManage: access.canManage };
    }),
  ).then((teams) => teams.sort((a, b) => a.key.localeCompare(b.key)));
}

export function useTeamsQuery() {
  return useQuery({
    queryKey: qk.teams,
    queryFn: fetchTeams,
  });
}

// Join a team the caller can see (Linear lets anyone but a guest join a public
// team). Refetches the list so the team moves into the sidebar.
export function useJoinTeam() {
  const qc = useQueryClient();
  const { data: session } = useSession();
  return useMutation({
    mutationFn: (teamKey: string) => createMembership(teamKey, session!.user.id),
    onSuccess: (_data, teamKey) => {
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}

// Returns a callback that invalidates a team's detail query. Used by the
// settings service mutations to refresh the team after a structural write.
export function useInvalidateTeam(teamKey: string | null) {
  const qc = useQueryClient();
  return () => {
    if (teamKey) {
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      // A structural change (deleted/renamed label or column) can
      // affect how the board's issues render, so refresh the board issues too.
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
    }
    // A structural change (renamed/deleted label, assignee or column) can change
    // what an open issue detail shows — its values come
    // from the issue query, not the team — so refresh any open issue too. Only
    // the active (open) issue actually refetches.
    void qc.invalidateQueries({ queryKey: qk.anyIssue });
  };
}

const TeamCreate = graphql(`
  mutation TeamCreate($input: TeamCreateInput!) {
    teamCreate(input: $input) {
      team {
        id
        key
        name
        description
        visibility
        createdAt
      }
    }
  }
`);

const TeamUpdate = graphql(`
  mutation TeamUpdate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      team {
        id
        key
        name
        description
        visibility
        createdAt
      }
    }
  }
`);

const TeamDelete = graphql(`
  mutation TeamDelete($id: String!) {
    teamDelete(id: $id) {
      success
    }
  }
`);

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
    }: {
      input: { key: string; name: string; description?: string };
    }): Promise<Team> => {
      const data = await gqlRequest(TeamCreate, { input });
      // The creator becomes the team's first member and owner (the API's rule).
      return { ...toTeam(data.teamCreate.team!), role: 'owner', canManage: true };
    },
    onSuccess: (team) => {
      // Add the new team to the cached list immediately so navigating to it
      // (onCreated → setTeamKey) sticks. Otherwise the list has not refetched
      // yet and App's "unknown team key" guard bounces back to the first team.
      qc.setQueryData<Team[]>(qk.teams, (prev) => (prev ? [...prev, team] : [team]));
      void qc.invalidateQueries({ queryKey: qk.teams });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      teamKey,
      patch,
    }: {
      teamKey: string;
      patch: { name?: string; description?: string; visibility?: TeamVisibility };
    }): Promise<Team> => {
      const { visibility, ...rest } = patch;
      const input = {
        ...rest,
        ...(visibility !== undefined ? { private: visibility === 'private' } : {}),
      };
      // teamUpdate takes the team key as its id, as team(id:) does.
      const data = await gqlRequest(TeamUpdate, { id: teamKey, input });
      return toTeam(data.teamUpdate.team!);
    },
    onSuccess: (updated, { teamKey }) => {
      // Reflect the new name/description in the cached list immediately, then
      // refetch the list and the team detail (its header and switcher read
      // the name) to reconcile.
      // Merge only the edited fields — the update response carries no `role`, so
      // spreading the whole object would wipe the caller's role in the list item.
      qc.setQueryData<Team[]>(qk.teams, (prev) =>
        prev?.map((p) =>
          p.key === teamKey
            ? {
                ...p,
                name: updated.name,
                description: updated.description,
                visibility: updated.visibility,
              }
            : p,
        ),
      );
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
    },
  });
}

// Drops the team from the cached list immediately (so it disappears even
// before the refetch resolves) and discards its now-dead per-team caches so it
// cannot be reopened with stale data. Then refetches the list to reconcile.
function forgetTeam(qc: ReturnType<typeof useQueryClient>, teamKey: string) {
  qc.setQueryData<Team[]>(qk.teams, (prev) => prev?.filter((p) => p.key !== teamKey));
  qc.removeQueries({ queryKey: qk.team(teamKey) });
  qc.removeQueries({ queryKey: qk.boardIssues(teamKey) });
  qc.removeQueries({ queryKey: qk.views(teamKey) });
  void qc.invalidateQueries({ queryKey: qk.teams });
}

// Leave a team you are a member of (self-removal). A public team stays visible
// (and listed with role null); a private one disappears, so its caches are dropped.
export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamKey, userId }: { teamKey: string; userId: string }) =>
      removeTeamMember(qc, teamKey, userId),
    onSuccess: (_data, { teamKey }) => {
      const team = qc.getQueryData<Team[]>(qk.teams)?.find((t) => t.key === teamKey);
      if (team?.visibility === 'private') {
        forgetTeam(qc, teamKey);
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamKey: string) => gqlRequest(TeamDelete, { id: teamKey }),
    onSuccess: (_data, teamKey) => forgetTeam(qc, teamKey),
  });
}

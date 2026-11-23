import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { MemberRole, MemberRow } from '@/lib/api';
import { instanceFetch } from '@/lib/auth-client';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { membershipOf, toMemberRows, toWorkspaceUser } from '@/utils/members';

const TeamMembersPage = graphql(`
  query TeamMembers($teamKey: String!, $after: String, $first: Int) {
    team(id: $teamKey) {
      id
      memberships(first: $first, after: $after) {
        nodes {
          id
          owner
          createdAt
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

const WorkspaceUsersPage = graphql(`
  query WorkspaceUsers($after: String, $first: Int) {
    users(first: $first, after: $after, includeDisabled: true) {
      nodes {
        id
        name
        email
        avatarUrl
        createdAt
        active
        owner
        admin
        guest
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const MembershipCreate = graphql(`
  mutation TeamMembershipCreate($input: TeamMembershipCreateInput!) {
    teamMembershipCreate(input: $input) {
      success
    }
  }
`);

const MembershipDelete = graphql(`
  mutation TeamMembershipDelete($id: String!) {
    teamMembershipDelete(id: $id) {
      success
    }
  }
`);

async function fetchMembers(teamKey: string): Promise<MemberRow[]> {
  let teamId = '';
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(TeamMembersPage, { teamKey, after, first });
    teamId = data.team.id;
    return data.team.memberships;
  });
  return toMemberRows(teamId, nodes);
}

// The team's members from the cache, loading them when the Members page has not.
const membersOf = (qc: QueryClient, teamKey: string) =>
  qc.ensureQueryData({ queryKey: qk.members(teamKey), queryFn: () => fetchMembers(teamKey) });

// Removing a member addresses their TeamMembership. Used by the Members page and by
// leaving a team (services/teams.service.ts).
export async function removeTeamMember(qc: QueryClient, teamKey: string, userId: string) {
  const member = membershipOf(await membersOf(qc, teamKey), userId);
  if (!member) return;
  await gqlRequest(MembershipDelete, { id: member.membershipId });
}

// Joining a public team is a membership the viewer creates for themselves;
// teamMembershipCreate takes the team key as its teamId, as team(id:) does.
export const joinTeam = (teamKey: string, userId: string) =>
  gqlRequest(MembershipCreate, { input: { teamId: teamKey, userId } });

export function useMembersQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.members(teamKey ?? ''),
    queryFn: () => fetchMembers(teamKey!),
    enabled: teamKey != null,
  });
}

// Add a workspace user to the team (any member of a public team; a team manager of
// a private one).
export function useAddMember(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => joinTeam(teamKey, userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      toast.success('Member added');
    },
  });
}

export function useRemoveMember(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeTeamMember(qc, teamKey, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(teamKey) }),
  });
}

// Make a member a team owner, or back to a plain member (team managers). Linear's
// schema has no input that sets TeamMembership.owner, so this goes through the
// instance plugin on better-auth.
export function useSetMemberRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: MemberRole }) => {
      const member = membershipOf(await membersOf(qc, teamKey), userId);
      if (!member) throw new Error('This person is not a member of the team');
      return instanceFetch('/instance/team-owner', {
        method: 'POST',
        body: { teamId: member.teamId, userId, owner: role === 'owner' },
      });
    },
    onSuccess: (_data, { role }) => {
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.teams });
      toast.success(role === 'owner' ? 'Member made a team owner' : 'Team owner removed');
    },
  });
}

// The workspace's users, suspended ones included. Guests cannot list them; pass
// enabled=false for a guest so the query does not fire.
export function useWorkspaceUsersQuery(enabled = true) {
  return useQuery({
    queryKey: qk.workspaceUsers,
    queryFn: async () =>
      (
        await fetchAllPages(
          async (after, first) => (await gqlRequest(WorkspaceUsersPage, { after, first })).users,
        )
      ).map(toWorkspaceUser),
    enabled,
  });
}

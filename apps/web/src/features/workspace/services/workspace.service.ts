import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { InviteRole, InviteRow, WorkspaceRole } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { toInviteRow } from '../utils/invites';

const InvitesPage = graphql(`
  query OrganizationInvites($after: String, $first: Int) {
    organizationInvites(first: $first, after: $after) {
      nodes {
        id
        email
        role
        createdAt
        expiresAt
        metadata
        inviter {
          id
          name
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`);

const InviteCreate = graphql(`
  mutation OrganizationInviteCreate($input: OrganizationInviteCreateInput!) {
    organizationInviteCreate(input: $input) {
      organizationInvite {
        id
        email
        role
        createdAt
        expiresAt
        metadata
        inviter {
          id
          name
        }
      }
    }
  }
`);

const InviteDelete = graphql(`
  mutation OrganizationInviteDelete($id: String!) {
    organizationInviteDelete(id: $id) {
      success
    }
  }
`);

const ChangeRole = graphql(`
  mutation UserChangeRole($id: String!, $role: UserRoleType!) {
    userChangeRole(id: $id, role: $role) {
      success
    }
  }
`);

const Suspend = graphql(`
  mutation UserSuspend($id: String!) {
    userSuspend(id: $id) {
      success
    }
  }
`);

const Unsuspend = graphql(`
  mutation UserUnsuspend($id: String!) {
    userUnsuspend(id: $id) {
      success
    }
  }
`);

// Linear names a workspace member `user`.
const linearRole = (role: WorkspaceRole | InviteRole) => (role === 'member' ? 'user' : role);

// Pending workspace invites. Guests cannot list them; pass enabled=false for a
// guest so the query does not fire.
export function useInvitesQuery(enabled = true) {
  return useQuery({
    queryKey: qk.invites,
    queryFn: async () =>
      (
        await fetchAllPages(
          async (after, first) =>
            (await gqlRequest(InvitesPage, { after, first })).organizationInvites,
        )
      ).map(toInviteRow),
    enabled,
  });
}

// Resolves to the created invite, whose token is always set for its sender, so the
// dialog can copy the link at once.
export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email: string;
      role: InviteRole;
      teamIds: string[];
    }): Promise<InviteRow> => {
      const data = await gqlRequest(InviteCreate, {
        input: { email: input.email, role: linearRole(input.role), teamIds: input.teamIds },
      });
      return toInviteRow(data.organizationInviteCreate.organizationInvite);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.invites });
      toast.success('Invite created');
    },
  });
}

export function useDeleteInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => gqlRequest(InviteDelete, { id: inviteId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites }),
  });
}

export function useSetWorkspaceRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      gqlRequest(ChangeRole, { id: userId, role: linearRole(role) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaceUsers });
      toast.success('Role updated');
    },
  });
}

// Suspend or unsuspend a user (Linear's way to remove someone from the workspace).
export function useSetSuspended() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, suspended }: { userId: string; suspended: boolean }) => {
      if (suspended) await gqlRequest(Suspend, { id: userId });
      else await gqlRequest(Unsuspend, { id: userId });
    },
    onSuccess: (_data, { suspended }) => {
      void qc.invalidateQueries({ queryKey: qk.workspaceUsers });
      toast.success(suspended ? 'User suspended' : 'User unsuspended');
    },
  });
}

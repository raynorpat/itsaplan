// Data access for the public invite page: read the invite by the token in its link
// through Linear's organizationInviteDetails, the one GraphQL query that answers
// without a session. Joining happens through the normal sign-in: the account created
// for the invited email (by its magic link or Google) takes the invite's role and
// teams.

import { useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { inviteRoleFromLinear } from '@/utils/workspaceRoles';
import type { InviteRole } from '@/types/workspace';

// An invite as shown to the invitee opening the link (no sign-in needed).
export interface InviteView {
  email: string;
  role: InviteRole;
  invitedByName: string | null;
}

const InviteDetails = graphql(`
  query InviteDetails($id: String!) {
    organizationInviteDetails(id: $id) {
      ... on OrganizationInviteFullDetailsPayload {
        email
        role
        inviter
      }
    }
  }
`);

export function useInviteQuery(token: string) {
  return useQuery({
    queryKey: ['invite', token],
    queryFn: async (): Promise<InviteView | null> => {
      const details = (await gqlRequest(InviteDetails, { id: token })).organizationInviteDetails;
      if (!('email' in details)) return null;
      return {
        email: details.email,
        role: inviteRoleFromLinear(details.role),
        invitedByName: details.inviter || null,
      };
    },
    // A bad token is not found, not a transient failure — do not retry.
    retry: false,
  });
}

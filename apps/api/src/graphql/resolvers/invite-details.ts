import { getInviteDetailsByToken } from '../../invites/store';
import { UUID_RE } from '../../shared/lib';
import { gqlError } from '../errors';
import { guard } from './mutations';
import { getOrganization } from './organization';

// Linear's organizationInviteDetails, the one operation that answers without a login
// (the invite page is opened before an account exists; see anonymous.ts). Its `id` is
// the invite's secret token from the invite link, not the invite's id, so seeing an
// invite in a list does not allow a public lookup. A pending invite answers with its
// details; an unknown, used or expired one is not found.

const linearRole = (role: string) => (role === 'member' ? 'user' : role);

export const inviteDetailsResolvers = {
  OrganizationInviteDetailsPayload: {
    __resolveType: () => 'OrganizationInviteFullDetailsPayload',
  },
  Query: {
    organizationInviteDetails: (_: unknown, { id }: { id: string }) =>
      guard(async () => {
        const invite = UUID_RE.test(id) ? await getInviteDetailsByToken(id) : null;
        if (!invite) throw gqlError('ENTITY_NOT_FOUND', 'Invite not found');
        const org = await getOrganization();
        return {
          accepted: false,
          expired: false,
          status: 'pending',
          email: invite.email,
          role: linearRole(invite.role),
          inviter: invite.invitedByName ?? '',
          createdAt: invite.createdAt,
          organizationId: org.id,
          organizationName: org.name,
          organizationLogoUrl: org.logoUrl,
          allowedAuthServices: org.allowedAuthServices,
        };
      }),
  },
};

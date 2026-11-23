'use client';

import type { WorkspaceRole } from '@/types/workspace';
import { isWorkspaceAdmin } from '@/utils/workspaceRoles';
import { useTeamsQuery } from '@/services/teams.service';
import { useDeleteInvite, useInvitesQuery } from '../services/workspace.service';
import WorkspaceInviteRow from './WorkspaceInviteRow';

// The workspace's pending invites. Revoking is for the invite's sender and admins.
export default function WorkspaceInvites({
  viewerRole,
  viewerId,
}: {
  viewerRole: WorkspaceRole;
  viewerId: string | null;
}) {
  const invitesQuery = useInvitesQuery();
  const teams = useTeamsQuery().data ?? [];
  const deleteInvite = useDeleteInvite();
  const invites = invitesQuery.data ?? [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  if (invitesQuery.isPending || invites.length === 0) return null;

  return (
    <section className="mb-8 space-y-2">
      <h2 className="text-sm font-medium">Pending invites</h2>
      {invites.map((invite) => (
        <WorkspaceInviteRow
          key={invite.id}
          invite={invite}
          teamNames={invite.teamIds.flatMap((id) => teamName.get(id) ?? [])}
          canRevoke={isWorkspaceAdmin(viewerRole) || invite.invitedByUserId === viewerId}
          onRevoke={() => deleteInvite.mutate(invite.id)}
        />
      ))}
    </section>
  );
}

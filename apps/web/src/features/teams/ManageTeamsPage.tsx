'use client';

import { useState } from 'react';
import type { Team } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { useJoinTeam, useTeamsQuery } from '@/services/teams.service';
import { toWorkspaceRole } from '@/utils/workspaceRoles';
import FullPageView from '@/components/common/page/FullPageView';
import ManageTeamsList from './components/ManageTeamsList';
import ManageTeamsDeleteDialog from './components/ManageTeamsDeleteDialog';
import ManageTeamsLeaveDialog from './components/ManageTeamsLeaveDialog';

// Every team the user can see. Owners, admins and members join public teams here;
// anyone leaves a team they are in, and a team's managers delete it.
export default function ManageTeamsPage() {
  const { data: teams, isPending } = useTeamsQuery();
  const { data: session } = useSession();
  const joinTeam = useJoinTeam();
  const canJoin = toWorkspaceRole(session?.user.workspaceRole) !== 'guest';
  const [deleting, setDeleting] = useState<Team | null>(null);
  const [leaving, setLeaving] = useState<Team | null>(null);

  return (
    <FullPageView
      label="Teams"
      title="Browse teams"
      description="Every team you can see. Join a public team to add it to your sidebar; leave a team at any time. A team's owners and workspace admins can delete it, which permanently removes the team and everything in it."
    >
      <ManageTeamsList
        teams={teams ?? []}
        isPending={isPending}
        canJoin={canJoin}
        joining={joinTeam.isPending ? (joinTeam.variables ?? null) : null}
        onJoin={(team) => joinTeam.mutate(team.key)}
        onDelete={setDeleting}
        onLeave={setLeaving}
      />

      {deleting && <ManageTeamsDeleteDialog team={deleting} onClose={() => setDeleting(null)} />}

      {leaving && session?.user.id && (
        <ManageTeamsLeaveDialog
          team={leaving}
          userId={session.user.id}
          onClose={() => setLeaving(null)}
        />
      )}
    </FullPageView>
  );
}

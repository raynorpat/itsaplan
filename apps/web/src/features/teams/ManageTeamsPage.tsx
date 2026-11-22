'use client';

import { useState } from 'react';
import type { Team } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { useTeamsQuery } from '@/services/teams.service';
import FullPageView from '@/components/common/page/FullPageView';
import ManageTeamsList from './components/ManageTeamsList';
import ManageTeamsDeleteDialog from './components/ManageTeamsDeleteDialog';
import ManageTeamsLeaveDialog from './components/ManageTeamsLeaveDialog';

// The delete/leave mutations drop the team from the cached list, so the row
// disappears without a manual refetch.
export default function ManageTeamsPage() {
  const { data: teams, isPending } = useTeamsQuery();
  const { data: session } = useSession();
  const [deleting, setDeleting] = useState<Team | null>(null);
  const [leaving, setLeaving] = useState<Team | null>(null);

  return (
    <FullPageView
      label="Manage teams"
      title="Manage teams"
      description="Every team you belong to, with your permissions in each. Owners can delete a team; members can leave one. Deleting permanently removes the team and everything in it."
    >
      <ManageTeamsList
        teams={teams ?? []}
        isPending={isPending}
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

'use client';

import type { Team } from '@/types/team';
import { useLeaveTeam } from '@/services/teams.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';

export default function ManageTeamsLeaveDialog({
  team,
  userId,
  onClose,
}: {
  team: Team;
  userId: string;
  onClose: () => void;
}) {
  const leaveTeam = useLeaveTeam();

  return (
    <ConfirmDialog
      title={`Leave ${team.name}?`}
      confirmLabel="Leave team"
      onClose={onClose}
      onConfirm={async () => {
        await leaveTeam.mutateAsync({ teamKey: team.key, userId });
        onClose();
      }}
    >
      <p className="text-sm text-muted-foreground">
        {team.visibility === 'private' ? (
          <>
            You will lose access to <span className="font-medium text-foreground">{team.name}</span>{' '}
            and its work items. A member of the team can add you back.
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">{team.name}</span> leaves your sidebar. It
            stays public, so you can still open it and join again.
          </>
        )}
      </p>
    </ConfirmDialog>
  );
}

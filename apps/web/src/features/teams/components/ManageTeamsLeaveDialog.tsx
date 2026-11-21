'use client';

import type { Team } from '@/lib/api';
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
        You will lose access to <span className="font-medium text-foreground">{team.name}</span> and
        its work items. To join again you need a new invite from an owner.
      </p>
    </ConfirmDialog>
  );
}

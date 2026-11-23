'use client';

import { useState } from 'react';
import type { Team } from '@/types/team';
import { useDeleteTeam } from '@/services/teams.service';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { Input } from '@/components/ui/input';

export default function ManageTeamsDeleteDialog({
  team,
  onClose,
}: {
  team: Team;
  onClose: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const deleteTeam = useDeleteTeam();
  const matches = confirmText.trim() === team.key;

  return (
    <ConfirmDialog
      title={`Delete ${team.name}?`}
      confirmLabel="Delete permanently"
      confirmDisabled={!matches}
      onClose={onClose}
      onConfirm={async () => {
        await deleteTeam.mutateAsync(team.key);
        onClose();
      }}
    >
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          This permanently deletes <span className="font-medium text-foreground">{team.name}</span>{' '}
          and everything in it: issues, comments, attachments, and settings. This cannot be undone.
        </p>
        <p>
          Type <span className="font-mono font-medium text-foreground">{team.key}</span> to confirm.
        </p>
      </div>
      <Input
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={team.key}
        autoFocus
      />
    </ConfirmDialog>
  );
}

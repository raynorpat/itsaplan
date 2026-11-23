'use client';

import { toast } from 'sonner';
import type { TeamDetail, TeamVisibility } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import { useUpdateTeam } from '@/services/teams.service';

export interface VisibilityToggleForm {
  visibility: TeamVisibility;
  // Only a team manager may change it; others see it read-only.
  editable: boolean;
  saving: boolean;
  change: (visibility: TeamVisibility) => Promise<void>;
}

// The team's visibility (Linear's public / private), saved on its own like the
// feature switches.
export function useVisibilityToggle(team: TeamDetail): VisibilityToggleForm {
  const { canManage } = usePermissions();
  const update = useUpdateTeam();

  async function change(visibility: TeamVisibility) {
    await update.mutateAsync({ teamKey: team.team.key, patch: { visibility } });
    toast.success(visibility === 'private' ? 'Team is now private' : 'Team is now public');
  }

  return {
    visibility: team.team.visibility,
    editable: canManage,
    saving: update.isPending,
    change,
  };
}

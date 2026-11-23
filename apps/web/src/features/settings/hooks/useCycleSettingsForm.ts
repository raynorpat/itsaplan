import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { TeamCycleSettings, TeamDetail } from '@/types/team';
import { usePermissions } from '@/hooks/usePermissions';
import { useUpdateTeamCycles } from '../services/settings.service';
import { cycleSettingsInput } from '../utils/cycleSettings';

// The cycle settings form state, shared between the page header (Save) and the body.
// Seeds from the team scaffold and reseeds whenever the stored settings change.
export interface CycleSettingsFormState {
  editable: boolean;
  saving: boolean;
  save: () => Promise<void>;
  values: TeamCycleSettings;
  set: (patch: Partial<TeamCycleSettings>) => void;
}

export function useCycleSettingsForm(team: TeamDetail): CycleSettingsFormState {
  const { canManage } = usePermissions();
  const update = useUpdateTeamCycles(team.team.key, team.team.id);
  const [values, setValues] = useState(team.cycles);

  const stored = team.cycles;
  useEffect(() => setValues(stored), [stored]);

  async function save() {
    const result = cycleSettingsInput(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    await update.mutateAsync(result.input);
    toast.success('Cycle settings saved');
  }

  return {
    editable: canManage,
    saving: update.isPending,
    save,
    values,
    set: (patch) => setValues((v) => ({ ...v, ...patch })),
  };
}

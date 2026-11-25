import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { TeamDetail } from '@/types/team';
import type { TeamEstimateSettings } from '@/utils/estimates';
import { usePermissions } from '@/hooks/usePermissions';
import { useUpdateTeamEstimates } from '../services/settings.service';
import { estimateSettingsInput, parseDefaultEstimate } from '../utils/estimateSettings';

// The Estimates form state, shared between the page header (Save) and the body. The
// default estimate is kept as typed text until saved. Seeds from the team scaffold and
// reseeds whenever the stored settings change.
export interface EstimateSettingsFormState {
  editable: boolean;
  saving: boolean;
  save: () => Promise<void>;
  values: TeamEstimateSettings;
  set: (patch: Partial<TeamEstimateSettings>) => void;
  defaultText: string;
  setDefaultText: (text: string) => void;
}

export function useEstimateSettingsForm(team: TeamDetail): EstimateSettingsFormState {
  const { canManage } = usePermissions();
  const update = useUpdateTeamEstimates(team.team.key, team.team.id);
  const stored = team.estimates;
  const [values, setValues] = useState(stored);
  const [defaultText, setDefaultText] = useState(String(stored.defaultEstimate));

  useEffect(() => {
    setValues(stored);
    setDefaultText(String(stored.defaultEstimate));
  }, [stored]);

  async function save() {
    const defaultEstimate = parseDefaultEstimate(defaultText);
    if (defaultEstimate == null) {
      toast.error('The default estimate must be a number of at least 0');
      return;
    }
    await update.mutateAsync(estimateSettingsInput({ ...values, defaultEstimate }));
    toast.success('Estimate settings saved');
  }

  return {
    editable: canManage,
    saving: update.isPending,
    save,
    values,
    set: (patch) => setValues((v) => ({ ...v, ...patch })),
    defaultText,
    setDefaultText,
  };
}

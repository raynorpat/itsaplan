'use client';

import { toast } from 'sonner';
import type { TeamDetail, TeamFeatures } from '@/lib/api';
import { FEATURE_LABEL } from '@/utils/teamFeatures';
import { usePermissions } from '@/hooks/usePermissions';
import { useUpdateTeamFeatures } from '../services/settings.service';

export interface FeatureTogglesForm {
  features: TeamFeatures;
  // Only an owner may toggle; others see the current state read-only.
  editable: boolean;
  saving: boolean;
  toggle: (feature: keyof TeamFeatures, enabled: boolean) => Promise<void>;
}

// The optional sections of the team (projects, dashboards, notes), read from
// the team payload the Shell already loaded. Each switch saves on its own —
// there is nothing to draft, so the General page's Save button does not cover it.
export function useFeatureToggles(team: TeamDetail): FeatureTogglesForm {
  const { isOwner } = usePermissions();
  const update = useUpdateTeamFeatures(team.team.key);
  const { projectsEnabled, dashboardsEnabled, notesEnabled } = team.team;

  async function toggle(feature: keyof TeamFeatures, enabled: boolean) {
    await update.mutateAsync({ [feature]: enabled });
    toast.success(`${FEATURE_LABEL[feature]} turned ${enabled ? 'on' : 'off'}`);
  }

  return {
    features: {
      projects: projectsEnabled,
      dashboards: dashboardsEnabled,
      notes: notesEnabled,
    },
    editable: isOwner,
    saving: update.isPending,
    toggle,
  };
}

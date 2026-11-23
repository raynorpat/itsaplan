'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { TeamDetail } from '@/types/team';
import { useUpdateTeam } from '@/services/teams.service';
import { usePermissions } from '@/hooks/usePermissions';

export interface GeneralForm {
  key: string;
  name: string;
  description: string;
  setName: (v: string) => void;
  setDescription: (v: string) => void;
  // Only a team manager may edit; others see the current values read-only.
  editable: boolean;
  saving: boolean;
  canSave: boolean;
  save: () => Promise<void>;
}

// Form state for the General settings page: the team name and description. The
// key is read-only. Shared between the header Save button and the body fields, so
// it lives in a hook and is threaded into both.
export function useGeneralForm(team: TeamDetail): GeneralForm {
  const { canManage } = usePermissions();
  const { key, name: savedName, description: savedDescription } = team.team;
  const updateTeam = useUpdateTeam();

  const [name, setName] = useState(savedName);
  const [description, setDescription] = useState(savedDescription);

  const trimmedName = name.trim();
  const dirty = trimmedName !== savedName || description !== savedDescription;
  const canSave = canManage && trimmedName.length > 0 && dirty && !updateTeam.isPending;

  async function save() {
    await updateTeam.mutateAsync({
      teamKey: key,
      patch: { name: trimmedName, description },
    });
    toast.success('Team updated');
  }

  return {
    key,
    name,
    description,
    setName,
    setDescription,
    editable: canManage,
    saving: updateTeam.isPending,
    canSave,
    save,
  };
}

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useAutoArchiveQuery, useUpdateAutoArchive } from '../services/settings.service';

// The auto-archive period form state (months; 0 = off), shared between the page
// header (the Save action) and the body (the period select). Seeds from the stored
// setting and reseeds whenever it changes (e.g. after a save).
export interface AutoArchiveForm {
  editable: boolean;
  saving: boolean;
  save: () => Promise<void>;
  period: number;
  setPeriod: (v: number) => void;
}

export function useAutoArchiveForm(teamKey: string): AutoArchiveForm {
  const { canManage } = usePermissions();
  const settingsQuery = useAutoArchiveQuery(teamKey);
  const updateSettings = useUpdateAutoArchive(teamKey);
  const [period, setPeriod] = useState(0);

  const stored = settingsQuery.data;
  useEffect(() => {
    if (stored !== undefined) setPeriod(stored);
  }, [stored]);

  async function save() {
    await updateSettings.mutateAsync(period);
    toast.success('Auto-archive settings saved');
  }

  return { editable: canManage, saving: updateSettings.isPending, save, period, setPeriod };
}

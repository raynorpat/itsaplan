import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { qk } from '@/services/queryKeys';
import { fetchListPreferences, saveListPreferences } from '@/services/listPreferences.service';
import type { ViewPreferenceValues } from '@/utils/viewPreferences';
import {
  displayFromPreferences,
  preferencesFromDisplay,
  type ProjectsDisplay,
} from '../utils/projectsDisplay';

// The viewer's projects list display (layout, timeline grouping and zoom), kept on
// the server. A change shows at once and is saved; a failed save shows the error and
// returns to the stored display. Nothing is saved before the stored display has loaded,
// so the defaults never replace it.
export function useProjectsDisplay() {
  const qc = useQueryClient();
  const key = qk.listPreferences('projects');
  const query = useQuery({ queryKey: key, queryFn: () => fetchListPreferences('projects') });
  const display = displayFromPreferences(query.data);

  const save = useMutation({
    mutationFn: (prefs: ViewPreferenceValues) => saveListPreferences('projects', prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ViewPreferenceValues | null>(key);
      qc.setQueryData(key, prefs);
      return { previous };
    },
    onError: (err, _prefs, context) => {
      qc.setQueryData(key, context?.previous ?? null);
      toast.error(err instanceof Error ? err.message : 'The display settings were not saved');
    },
  });

  const update = (patch: Partial<ProjectsDisplay>) => {
    if (!query.isSuccess) return;
    save.mutate(preferencesFromDisplay({ ...display, ...patch }));
  };

  return { display, ready: query.isSuccess, update };
}

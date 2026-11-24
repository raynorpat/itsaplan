import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { qk } from '@/services/queryKeys';
import { fetchListPreferences, saveListPreferences } from '@/services/listPreferences.service';
import {
  createDebouncedSaver,
  toDisplay,
  toStored,
  type DebouncedSaver,
  type ListViewType,
} from '@/utils/listPreferences';
import type { SavedViewDisplay } from '@/utils/viewSettings';

const SAVE_DELAY_MS = 300;

// The viewer's display for one list kind, kept on the server. A change shows at once
// and is saved in the background; quick successive changes go out as one save, and
// a pending save is sent when the list is left. A failed save shows the error and
// returns to the last saved display. `ready` is false until the stored display is
// loaded, so a list does not first render with the defaults.
export function useListPreferences(viewType: ListViewType) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.listPreferences(viewType),
    queryFn: () => fetchListPreferences(viewType),
  });
  const [local, setLocal] = useState<SavedViewDisplay | null>(null);

  const saver = useRef<DebouncedSaver<SavedViewDisplay> | null>(null);
  if (saver.current == null) {
    saver.current = createDebouncedSaver((display: SavedViewDisplay) => {
      const stored = toStored(display);
      saveListPreferences(viewType, stored).then(
        () => qc.setQueryData(qk.listPreferences(viewType), stored),
        (err: unknown) => {
          toast.error(err instanceof Error ? err.message : 'The display settings were not saved');
          setLocal(null);
          void qc.invalidateQueries({ queryKey: qk.listPreferences(viewType) });
        },
      );
    }, SAVE_DELAY_MS);
  }

  useEffect(() => () => saver.current?.flush(), []);

  const display = useMemo(() => local ?? toDisplay(query.data), [local, query.data]);
  const update = useCallback((next: SavedViewDisplay) => {
    setLocal(next);
    saver.current?.push(next);
  }, []);

  return { display, update, ready: !query.isPending };
}

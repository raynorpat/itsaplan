import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { fetchListPreferences, saveListPreferences } from '@/services/listPreferences.service';
import {
  createPreferenceSync,
  preferencesState,
  type ListViewType,
  type PreferenceSync,
} from '@/utils/listPreferences';
import { displayToPreferences, preferencesToDisplay } from '@/utils/viewPreferences';
import type { SavedViewDisplay } from '@/utils/viewSettings';

const SAVE_DELAY_MS = 300;

// The viewer's display for one list kind, kept on the server. A change shows at once
// and is saved in the background: quick successive changes go out as one save, one
// save is in flight at a time, and a pending save is sent when the list is left or
// the page is hidden. A failed save shows the error and returns to the last saved
// display. Nothing is saved until the stored display has loaded (`status` 'ready'):
// while it loads the list waits, and after a failed load it shows the error with
// `retry`, so the defaults never replace the stored record.
export function useListPreferences(viewType: ListViewType) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.listPreferences(viewType),
    queryFn: () => fetchListPreferences(viewType),
  });
  const { status, canSave } = preferencesState(query);
  // The display shown while a change is unsaved; cleared once the server holds it,
  // so a later refetch (another tab's change) applies.
  const [local, setLocal] = useState<SavedViewDisplay | null>(null);

  const sync = useRef<PreferenceSync<SavedViewDisplay> | null>(null);
  if (sync.current == null) {
    sync.current = createPreferenceSync<SavedViewDisplay>({
      save: (display, keepalive) =>
        saveListPreferences(viewType, displayToPreferences(display), keepalive),
      delayMs: SAVE_DELAY_MS,
      onSaved: (display, latest) => {
        qc.setQueryData(qk.listPreferences(viewType), displayToPreferences(display));
        if (latest) setLocal((current) => (current === display ? null : current));
      },
      onFailed: (err, _display, newer) => {
        // Signed out meanwhile: the record is not reachable and nothing is lost.
        if (err instanceof ApiError && err.status === 401) return;
        toast.error(err instanceof Error ? err.message : 'The display settings were not saved');
        if (newer) return;
        setLocal(null);
        void qc.invalidateQueries({ queryKey: qk.listPreferences(viewType) });
      },
    });
  }

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') sync.current?.flush(true);
    };
    const onPageHide = () => sync.current?.flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      sync.current?.flush();
    };
  }, []);

  const display = useMemo(() => local ?? preferencesToDisplay(query.data), [local, query.data]);
  const update = useCallback(
    (next: SavedViewDisplay) => {
      if (!canSave) return;
      setLocal(next);
      sync.current?.push(next);
    },
    [canSave],
  );
  const { refetch } = query;
  const retry = useCallback(() => void refetch(), [refetch]);

  return {
    display,
    update,
    ready: status === 'ready',
    error:
      status === 'error' ? (query.error?.message ?? 'The display settings did not load') : null,
    retry,
  };
}

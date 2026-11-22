import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

// The interval between refreshes of a visible screen.
const LIVE_REFRESH_MS = 60_000;

// Live refresh: refetches the given queries so another user's change shows without a
// manual reload — once a minute while the tab is visible, and when the tab becomes
// visible again or the window regains focus. A refresh is skipped while a mutation is
// in flight, so it cannot overwrite an optimistic update with the old value. Stops
// when this hook unmounts, so nothing runs for a screen that is closed.
export function useLiveRefresh(opts: { targets: QueryKey[]; enabled?: boolean }) {
  const { targets, enabled = true } = opts;
  const qc = useQueryClient();
  // The keys are rebuilt on every render; their serialized form is the real input.
  const targetsKey = JSON.stringify(targets);

  useEffect(() => {
    if (!enabled) return;
    const keys = JSON.parse(targetsKey) as QueryKey[];
    const refresh = () => {
      if (document.visibilityState !== 'visible' || qc.isMutating() > 0) return;
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    };
    const id = window.setInterval(refresh, LIVE_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [qc, targetsKey, enabled]);
}

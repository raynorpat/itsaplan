import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

// Live refresh: invalidates the given queries on an interval so another user's
// change shows without a manual reload. Runs only while the tab is visible and
// stops when this hook unmounts, so nothing runs for a screen that is closed.
export function useLiveRefresh(opts: {
  // Query keys to refetch on each tick.
  targets: QueryKey[];
  intervalMs: number;
  enabled?: boolean;
}) {
  const { targets, intervalMs, enabled = true } = opts;
  const qc = useQueryClient();
  // The keys are rebuilt on every render; their serialized form is the real input.
  const targetsKey = JSON.stringify(targets);

  useEffect(() => {
    if (!enabled) return;
    const keys = JSON.parse(targetsKey) as QueryKey[];
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      for (const key of keys) void qc.invalidateQueries({ queryKey: key });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [qc, targetsKey, intervalMs, enabled]);
}

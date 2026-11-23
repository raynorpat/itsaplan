import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/services/queryKeys';

// Refetches the past cycles when the open cycles change (the current one closed, or
// one was added), so a cycle that just ended moves to "Past" with the next live
// refresh of the open list instead of on the next window focus.
export function usePastCyclesFollowOpen(teamId: string | null, openIds: string[] | undefined) {
  const qc = useQueryClient();
  const key = openIds?.join(',');
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (teamId == null || key === undefined) return;
    if (previous.current !== undefined && previous.current !== key)
      void qc.invalidateQueries({ queryKey: qk.cycles(teamId, 'past') });
    previous.current = key;
  }, [qc, teamId, key]);
}

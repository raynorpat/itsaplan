import { useMemo } from 'react';
import type { TeamDetail } from '@/types/team';
import { useBoardIssues, useTeamScaffold } from '@/services/board.service';

// The team of the open notification's issue, composed the way the Shell composes
// its team (scaffold + issues), for the issue pane. The inbox spans every team, so
// this may be a team other than the Shell's.
export function useInboxTeam(teamKey: string | null): TeamDetail | null {
  const scaffold = useTeamScaffold(teamKey).data ?? null;
  const issues = useBoardIssues(teamKey).data;
  return useMemo(
    () => (scaffold ? { ...scaffold, issues: issues ?? [] } : null),
    [scaffold, issues],
  );
}

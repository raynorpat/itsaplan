import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Team, type TeamVisibility } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// Every team the caller can see: joined teams plus public teams they have not
// joined (role null). Pickers that add work to a team use this list.
export function useTeamsQuery() {
  return useQuery({
    queryKey: qk.teams,
    queryFn: () => api.listTeams(),
  });
}

// Join a team the caller can see (Linear lets anyone but a guest join a public
// team). Refetches the list so the team moves into the sidebar.
export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamKey: string) => api.joinTeam(teamKey),
    onSuccess: (_data, teamKey) => {
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}

// Returns a callback that invalidates a team's detail query. Used by the
// settings service mutations to refresh the team after a structural write.
export function useInvalidateTeam(teamKey: string | null) {
  const qc = useQueryClient();
  return () => {
    if (teamKey) {
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      // A structural change (deleted/renamed label or column) can
      // affect how the board's issues render, so refresh the board issues too.
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
    }
    // A structural change (renamed/deleted label, assignee or column) can change
    // what an open issue detail shows — its values come
    // from the issue query, not the team — so refresh any open issue too. Only
    // the active (open) issue actually refetches.
    void qc.invalidateQueries({ queryKey: qk.anyIssue });
  };
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      input,
    }: {
      input: { key: string; name: string; description?: string; preset?: string };
    }) => api.createTeam(input),
    onSuccess: (team) => {
      // Add the new team to the cached list immediately so navigating to it
      // (onCreated → setTeamKey) sticks. Otherwise the list has not refetched
      // yet and App's "unknown team key" guard bounces back to the first team.
      qc.setQueryData<Team[]>(qk.teams, (prev) => (prev ? [...prev, team] : [team]));
      void qc.invalidateQueries({ queryKey: qk.teams });
    },
  });
}

export function useUpdateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      teamKey,
      patch,
    }: {
      teamKey: string;
      patch: { name?: string; description?: string; visibility?: TeamVisibility };
    }) => api.updateTeam(teamKey, patch),
    onSuccess: (updated, { teamKey }) => {
      // Reflect the new name/description in the cached list immediately, then
      // refetch the list and the team detail (its header and switcher read
      // the name) to reconcile.
      // Merge only the edited fields — the update response carries no `role`, so
      // spreading the whole object would wipe the caller's role in the list item.
      qc.setQueryData<Team[]>(qk.teams, (prev) =>
        prev?.map((p) =>
          p.key === teamKey
            ? {
                ...p,
                name: updated.name,
                description: updated.description,
                visibility: updated.visibility,
              }
            : p,
        ),
      );
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
    },
  });
}

// Drops the team from the cached list immediately (so it disappears even
// before the refetch resolves) and discards its now-dead per-team caches so it
// cannot be reopened with stale data. Then refetches the list to reconcile.
function forgetTeam(qc: ReturnType<typeof useQueryClient>, teamKey: string) {
  qc.setQueryData<Team[]>(qk.teams, (prev) => prev?.filter((p) => p.key !== teamKey));
  qc.removeQueries({ queryKey: qk.team(teamKey) });
  qc.removeQueries({ queryKey: qk.boardIssues(teamKey) });
  qc.removeQueries({ queryKey: qk.views(teamKey) });
  void qc.invalidateQueries({ queryKey: qk.teams });
}

// Leave a team you are a member of (self-removal). A public team stays visible
// (and listed with role null); a private one disappears, so its caches are dropped.
export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamKey, userId }: { teamKey: string; userId: string }) =>
      api.removeMember(teamKey, userId),
    onSuccess: (_data, { teamKey }) => {
      const team = qc.getQueryData<Team[]>(qk.teams)?.find((t) => t.key === teamKey);
      if (team?.visibility === 'private') {
        forgetTeam(qc, teamKey);
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.teams });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
    },
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamKey: string) => api.deleteTeam(teamKey),
    onSuccess: (_data, teamKey) => forgetTeam(qc, teamKey),
  });
}

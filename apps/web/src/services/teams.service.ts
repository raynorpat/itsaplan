import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Team } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useTeamsQuery() {
  // Request the caller's resolved permission matrix per team; the Manage
  // teams page shows it and the sidebar/switcher ignore the extra field.
  return useQuery({
    queryKey: qk.teams,
    queryFn: () => api.listTeams({ permissions: true }),
  });
}

// The board scaffold (columns, types, labels, custom fields, viewer). The issues
// come from useBoardIssuesQuery; the Shell composes the two.
export function useTeamQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.team(teamKey ?? ''),
    queryFn: () => api.getTeam(teamKey!),
    enabled: teamKey != null,
  });
}

// The board's issues plus its change marker, loaded alongside the scaffold.
export function useBoardIssuesQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.boardIssues(teamKey ?? ''),
    queryFn: () => api.getBoardIssues(teamKey!),
    enabled: teamKey != null,
  });
}

// Returns a callback that invalidates a team's detail query. Used by the
// settings service mutations to refresh the team after a structural write.
// Passing `withCustomFields` also refreshes the custom-field lists (the Custom
// fields tab edits those).
export function useInvalidateTeam(teamKey: string | null) {
  const qc = useQueryClient();
  return (withCustomFields = false) => {
    if (teamKey) {
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      // A structural change (deleted/renamed label, type, column, custom field) can
      // affect how the board's issues render, so refresh the board issues too.
      void qc.invalidateQueries({ queryKey: qk.boardIssues(teamKey) });
    }
    // A structural change (renamed/deleted label, type, assignee, column, or
    // custom field) can change what an open issue detail shows — its values come
    // from the issue query, not the team — so refresh any open issue too. Only
    // the active (open) issue actually refetches.
    void qc.invalidateQueries({ queryKey: qk.anyIssue });
    if (withCustomFields) void qc.invalidateQueries({ queryKey: qk.anyCustomFields });
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
      patch: { name?: string; description?: string };
    }) => api.updateTeam(teamKey, patch),
    onSuccess: (updated, { teamKey }) => {
      // Reflect the new name/description in the cached list immediately, then
      // refetch the list and the team detail (its header and switcher read
      // the name) to reconcile.
      // Merge only the edited fields — the update response carries no `role`, so
      // spreading the whole object would wipe the caller's role in the list item.
      qc.setQueryData<Team[]>(qk.teams, (prev) =>
        prev?.map((p) =>
          p.key === teamKey ? { ...p, name: updated.name, description: updated.description } : p,
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

// Leave a team you are a member of (self-removal). The API refuses if you are
// the team's last owner.
export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ teamKey, userId }: { teamKey: string; userId: string }) =>
      api.removeMember(teamKey, userId),
    onSuccess: (_data, { teamKey }) => forgetTeam(qc, teamKey),
  });
}

export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (teamKey: string) => api.deleteTeam(teamKey),
    onSuccess: (_data, teamKey) => forgetTeam(qc, teamKey),
  });
}

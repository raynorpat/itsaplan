// React Query hooks for everything the settings feature reads and writes: the
// team's structural entities (columns, labels and label groups), the auto-archive thresholds, the team cycle settings, the team notification delivery
// settings, and the session member's own notification preferences. Structural
// writes go through useTeamMutation and invalidate the team detail; the
// settings and notification writes return the stored result and put it straight
// into the cache. This module wraps the low-level fetch client (api.ts).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type NotificationPreferences, type TeamScaffold } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import type { CycleSettingsInput } from '../utils/cycleSettings';
import { useInvalidateTeam } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';

// A mutation whose success invalidates the team detail (and dependent lists).
// Shared by every settings write below.
function useTeamMutation<TArgs>(teamKey: string, mutationFn: (args: TArgs) => Promise<unknown>) {
  const invalidate = useInvalidateTeam(teamKey);
  return useMutation({ mutationFn, onSuccess: () => invalidate() });
}

export function useCreateColumn(teamKey: string) {
  return useTeamMutation(teamKey, (input: Parameters<typeof api.createState>[1]) =>
    api.createState(teamKey, input),
  );
}

export function useUpdateColumn(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateState>[2] }) =>
      api.updateState(teamKey, id, patch),
  );
}

export function useReorderColumns(teamKey: string) {
  return useTeamMutation(teamKey, (orderedIds: string[]) => api.reorderStates(teamKey, orderedIds));
}

export function useDeleteColumn(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, body }: { id: string; body: Parameters<typeof api.deleteState>[2] }) =>
      api.deleteState(teamKey, id, body),
  );
}

export function useCreateLabel(teamKey: string) {
  return useTeamMutation(teamKey, (input: Parameters<typeof api.createLabel>[1]) =>
    api.createLabel(teamKey, input),
  );
}

export function useUpdateLabel(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateLabel>[2] }) =>
      api.updateLabel(teamKey, id, patch),
  );
}

export function useDeleteLabel(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => api.deleteLabel(teamKey, id));
}

export function useCreateLabelGroup(teamKey: string) {
  return useTeamMutation(teamKey, (input: Parameters<typeof api.createLabelGroup>[1]) =>
    api.createLabelGroup(teamKey, input),
  );
}

export function useUpdateLabelGroup(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateLabelGroup>[2] }) =>
      api.updateLabelGroup(teamKey, id, patch),
  );
}

export function useDeleteLabelGroup(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => api.deleteLabelGroup(teamKey, id));
}

// Archive section: the team's auto-archive period in months, read from the team
// settings resource.
export function useAutoArchiveQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.teamSettings(teamKey),
    queryFn: () => api.getTeamSettings(teamKey),
    select: (s) => s.autoArchivePeriod,
  });
}

export function useUpdateAutoArchive(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (autoArchivePeriod: number) =>
      api.updateTeamSettings(teamKey, { autoArchivePeriod }),
    onSuccess: (data) => qc.setQueryData(qk.teamSettings(teamKey), data),
  });
}

const TeamCyclesUpdate = graphql(`
  mutation TeamCyclesUpdate($id: String!, $input: TeamUpdateInput!) {
    teamUpdate(id: $id, input: $input) {
      team {
        cyclesEnabled
        cycleDuration
        cycleStartDay
        cycleCooldownTime
        upcomingCycleCount
        cycleIssueAutoAssignStarted
        cycleIssueAutoAssignCompleted
      }
    }
  }
`);

// Cycles section: writes the team's cycle settings through teamUpdate and puts the
// stored values into the team scaffold, which the settings form and the sidebar read.
// Turning cycles on makes the API create the current and upcoming cycles, so the
// team's cycle queries refresh too.
export function useUpdateTeamCycles(teamKey: string, teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CycleSettingsInput) => gqlRequest(TeamCyclesUpdate, { id: teamId, input }),
    onSuccess: ({ teamUpdate: { team } }) => {
      if (!team) return;
      qc.setQueryData<TeamScaffold>(qk.team(teamKey), (old) =>
        old
          ? {
              ...old,
              cycles: {
                enabled: team.cyclesEnabled,
                duration: team.cycleDuration,
                startDay: team.cycleStartDay,
                cooldown: team.cycleCooldownTime,
                upcomingCount: team.upcomingCycleCount,
                autoAssignStarted: team.cycleIssueAutoAssignStarted,
                autoAssignCompleted: team.cycleIssueAutoAssignCompleted,
              },
            }
          : old,
      );
    },
  });
}

// The signed-in user's own email notification preferences, for the whole workspace.
// A write returns the full result, which replaces the cache directly.
export function useNotificationPreferencesQuery() {
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: () => api.getNotificationPreferences(),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferences) => api.setNotificationPreferences(input),
    onSuccess: (data) => qc.setQueryData(qk.notificationPreferences(), data),
  });
}

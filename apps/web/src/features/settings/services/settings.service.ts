// React Query hooks for everything the settings feature reads and writes: the
// team's structural entities (columns, issue types, labels and label groups,
// custom fields), the auto-archive thresholds, the team notification delivery
// settings, and the session member's own notification preferences. Structural
// writes go through useTeamMutation and invalidate the team detail; the
// settings and notification writes return the stored result and put it straight
// into the cache. This module wraps the low-level fetch client (api.ts).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type AutoArchiveSettings,
  type NotificationSettingsPatch,
  type NotificationPreferences,
  type TeamFeatures,
} from '@/lib/api';
import { useInvalidateTeam } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';

// A mutation whose success invalidates the team detail (and dependent lists).
// Shared by every settings write below.
function useTeamMutation<TArgs>(teamKey: string, mutationFn: (args: TArgs) => Promise<unknown>) {
  const invalidate = useInvalidateTeam(teamKey);
  return useMutation({ mutationFn, onSuccess: () => invalidate(true) });
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

export function useCreateIssueType(teamKey: string) {
  return useTeamMutation(teamKey, (input: Parameters<typeof api.createIssueType>[1]) =>
    api.createIssueType(teamKey, input),
  );
}

export function useUpdateIssueType(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateIssueType>[2] }) =>
      api.updateIssueType(teamKey, id, patch),
  );
}

export function useDeleteIssueType(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => api.deleteIssueType(teamKey, id));
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

// Archive section: the team's auto-archive thresholds, read from the team
// settings resource and narrowed to the autoArchive part for this section.
export function useAutoArchiveQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.teamSettings(teamKey),
    queryFn: () => api.getTeamSettings(teamKey),
    select: (s) => s.autoArchive,
  });
}

export function useUpdateAutoArchive(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AutoArchiveSettings) =>
      api.updateTeamSettings(teamKey, { autoArchive: input }),
    onSuccess: (data) => qc.setQueryData(qk.teamSettings(teamKey), data),
  });
}

// General section: which optional sections the team shows. The current state
// comes with the team payload (getTeam), so a write only invalidates it —
// the navigation and the sections themselves read it from there.
export function useUpdateTeamFeatures(teamKey: string) {
  const invalidate = useInvalidateTeam(teamKey);
  return useMutation({
    mutationFn: (input: Partial<TeamFeatures>) =>
      api.updateTeamSettings(teamKey, { features: input }),
    onSuccess: () => invalidate(),
  });
}

// Notifications section: the team's notification delivery settings. A write
// returns the redacted result, which replaces the cache directly.
export function useNotificationSettingsQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.notificationSettings(teamKey),
    queryFn: () => api.getNotificationSettings(teamKey),
  });
}

export function useUpdateNotificationSettings(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationSettingsPatch) => api.setNotificationSettings(teamKey, input),
    onSuccess: (data) => qc.setQueryData(qk.notificationSettings(teamKey), data),
  });
}

// The session member's own notification preferences for a team. A write returns
// the normalized result, which replaces the cache directly.
export function useNotificationPreferencesQuery(teamKey: string) {
  return useQuery({
    queryKey: qk.notificationPreferences(teamKey),
    queryFn: () => api.getNotificationPreferences(teamKey),
  });
}

export function useUpdateNotificationPreferences(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPreferences) => api.setNotificationPreferences(teamKey, input),
    onSuccess: (data) => qc.setQueryData(qk.notificationPreferences(teamKey), data),
  });
}

// Custom fields. Writes go through the team-scoped endpoint; the shared
// invalidation also refreshes the custom-field lists the reads depend on.
export function useCreateCustomField(teamKey: string) {
  return useTeamMutation(teamKey, (input: Parameters<typeof api.createCustomField>[1]) =>
    api.createCustomField(teamKey, input),
  );
}

export function useUpdateCustomField(teamKey: string) {
  return useTeamMutation(
    teamKey,
    ({ id, patch }: { id: string; patch: Parameters<typeof api.updateCustomField>[2] }) =>
      api.updateCustomField(teamKey, id, patch),
  );
}

export function useDeleteCustomField(teamKey: string) {
  return useTeamMutation(teamKey, (id: string) => api.deleteCustomField(teamKey, id));
}

'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type InstanceAuthSettingsPatch,
  type InstanceEmailSettingsPatch,
  type InstanceGoogleSettingsPatch,
  type StorageSettingsPatch,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';

// Data hooks for god mode. Every write returns the new state, which replaces the
// cache entry directly — these are single-row settings, so there is nothing else to
// invalidate. The invite list is a list, so its writes refetch it.

export function useInstanceAuthSettingsQuery() {
  return useQuery({
    queryKey: qk.instanceAuthSettings,
    queryFn: () => api.getInstanceAuthSettings(),
  });
}

export function useUpdateInstanceAuthSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: InstanceAuthSettingsPatch) => api.updateInstanceAuthSettings(patch),
    onSuccess: (data) => qc.setQueryData(qk.instanceAuthSettings, data),
  });
}

export function useInstanceEmailSettingsQuery() {
  return useQuery({
    queryKey: qk.instanceEmailSettings,
    queryFn: () => api.getInstanceEmailSettings(),
  });
}

export function useUpdateInstanceEmailSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: InstanceEmailSettingsPatch) => api.updateInstanceEmailSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(qk.instanceEmailSettings, data);
      // Turning a provider on unlocks the auth options that need outbound mail.
      void qc.invalidateQueries({ queryKey: qk.instanceAuthSettings });
    },
  });
}

export function useInstanceGoogleSettingsQuery() {
  return useQuery({
    queryKey: qk.instanceGoogleSettings,
    queryFn: () => api.getInstanceGoogleSettings(),
  });
}

export function useUpdateInstanceGoogleSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: InstanceGoogleSettingsPatch) => api.updateInstanceGoogleSettings(patch),
    onSuccess: (data) => qc.setQueryData(qk.instanceGoogleSettings, data),
  });
}

// The upload limits: file sizes, accepted attachment types, and the per-team
// storage quota.
export function useInstanceStorageSettingsQuery() {
  return useQuery({
    queryKey: qk.instanceStorageSettings,
    queryFn: () => api.getInstanceStorageSettings(),
  });
}

export function useUpdateInstanceStorageSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: StorageSettingsPatch) => api.updateInstanceStorageSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(qk.instanceStorageSettings, data);
      // The upload UI reads the same limits through the open endpoint.
      qc.setQueryData(qk.storageSettings, data);
    },
  });
}

export interface InstanceUserFilters {
  search: string;
  limit: number;
  offset: number;
}

// One page of the user directory. The filters are part of the key, and the previous
// page stays on screen while the next one loads so the table does not blank out on
// every keystroke or page step.
export function useInstanceUsersQuery(filters: InstanceUserFilters) {
  return useQuery({
    queryKey: qk.instanceUsers(filters),
    queryFn: () =>
      api.listInstanceUsers({
        search: filters.search || undefined,
        limit: filters.limit,
        offset: filters.offset,
      }),
    placeholderData: keepPreviousData,
  });
}

// One account with its team access. The detail panel mounts only while a user is
// selected, so there is no unselected state to fetch for.
export function useInstanceUserQuery(userId: string) {
  return useQuery({
    queryKey: qk.instanceUser(userId),
    queryFn: () => api.getInstanceUser(userId),
  });
}

export function useDeleteInstanceUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; withTeams: boolean }) =>
      api.deleteInstanceUser(input.userId, input.withTeams),
    onSuccess: (_data, input) => {
      qc.removeQueries({ queryKey: qk.instanceUser(input.userId) });
      void qc.invalidateQueries({ queryKey: qk.anyInstanceUsers });
      // Deleting the teams the user owned alone changes the sidebar's team
      // list and every team-scoped list the session holds.
      if (input.withTeams) void qc.invalidateQueries({ queryKey: qk.teams });
    },
  });
}

export interface InstanceTeamFilters {
  search: string;
  limit: number;
  offset: number;
}

// One page of the team directory. Like the user directory, the filters are part
// of the key and the previous page stays on screen while the next one loads.
export function useInstanceTeamsQuery(filters: InstanceTeamFilters) {
  return useQuery({
    queryKey: qk.instanceTeams(filters),
    queryFn: () =>
      api.listInstanceTeams({
        search: filters.search || undefined,
        limit: filters.limit,
        offset: filters.offset,
      }),
    placeholderData: keepPreviousData,
  });
}

// One team with its members. Mounted only while a team is selected, like the
// account panel.
export function useInstanceTeamQuery(teamId: string) {
  return useQuery({
    queryKey: qk.instanceTeam(teamId),
    queryFn: () => api.getInstanceTeam(teamId),
  });
}

export function useVerifyInstanceUserEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.verifyInstanceUserEmail(userId),
    onSuccess: (data) => {
      qc.setQueryData(qk.instanceUser(data.id), data);
      // The list carries emailVerified too, and its key holds the active filters.
      void qc.invalidateQueries({ queryKey: qk.anyInstanceUsers });
    },
  });
}

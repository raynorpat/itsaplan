// Dashboards through the instance plugin (/api/auth/instance/dashboards*), since
// Linear's schema has no dashboard type. The API checks the outer shape of widgets;
// parseWidgets drops anything this web app cannot render.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import type { Widget } from '@/utils/dashboards/config';
import { findTemplate } from '@/utils/dashboards/templates';
import {
  readDashboard,
  type DashboardResponse,
  type DashboardSharing,
  type DashboardSummary,
} from '../utils/response';

export type { Dashboard, DashboardSharing, DashboardSummary } from '../utils/response';

export function useDashboardsQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.dashboards,
    queryFn: async () =>
      (await instanceFetch<{ dashboards: DashboardSummary[] }>('/instance/dashboards')).dashboards,
    enabled,
  });
}

export function useDashboardQuery(id: string | null) {
  return useQuery({
    queryKey: qk.dashboard(id ?? ''),
    queryFn: async () =>
      readDashboard(
        await instanceFetch<DashboardResponse>(`/instance/dashboard?id=${encodeURIComponent(id!)}`),
      ),
    enabled: id != null,
    retry: false,
  });
}

export interface DashboardInput {
  name: string;
  description: string;
  sharedWith: DashboardSharing;
  teamIds: string[];
  widgets: Widget[];
}

function useDashboardWrite<V>(path: string, toBody: (v: V) => Record<string, unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: V) =>
      readDashboard(
        await instanceFetch<DashboardResponse>(path, { method: 'POST', body: toBody(v) }),
      ),
    onSuccess: (d) => {
      qc.setQueryData(qk.dashboard(d.id), d);
      void qc.invalidateQueries({ queryKey: qk.dashboards });
    },
  });
}

export const useCreateDashboard = () =>
  useDashboardWrite<DashboardInput>('/instance/dashboards/create', (v) => ({ ...v }));

export const useUpdateDashboard = () =>
  useDashboardWrite<Partial<DashboardInput> & { id: string }>(
    '/instance/dashboards/update',
    (v) => ({
      ...v,
    }),
  );

export const useDuplicateDashboard = () =>
  useDashboardWrite<string>('/instance/dashboards/duplicate', (id) => ({ id }));

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      instanceFetch<unknown>('/instance/dashboards/delete', { method: 'POST', body: { id } }),
    onSuccess: (_d, id) => {
      qc.removeQueries({ queryKey: qk.dashboard(id) });
      void qc.invalidateQueries({ queryKey: qk.dashboards });
    },
  });
}

// The workspace's Feedback report (Feedback → Reports): the API returns it, creating it
// from the Feedback template on the first open (one per workspace, owned by no one).
export function useFeedbackDashboard(enabled: boolean) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.feedbackDashboard,
    queryFn: async () => {
      const widgets = findTemplate('feedback')!.widgets({ bugLabelIds: [] });
      const d = readDashboard(
        await instanceFetch<DashboardResponse>('/instance/dashboards/feedback', {
          method: 'POST',
          body: { widgets },
        }),
      );
      qc.setQueryData(qk.dashboard(d.id), d);
      return d.id;
    },
    enabled,
    retry: false,
  });
}

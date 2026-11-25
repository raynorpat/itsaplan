// Dashboards through the instance plugin (/api/auth/instance/dashboards*), since
// Linear's schema has no dashboard type. The API checks the outer shape of widgets;
// parseWidgets drops anything this web app cannot render.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import { parseWidgets, type Widget } from '@/utils/dashboards/config';

export type DashboardSharing = 'workspace' | 'teams';

export interface DashboardSummary {
  id: string;
  name: string;
  description: string;
  ownerId: string | null;
  ownerName: string | null;
  systemKey: string | null;
  sharedWith: DashboardSharing;
  teamIds: string[];
  canEdit: boolean;
  updatedAt: string;
}

export interface Dashboard extends DashboardSummary {
  widgets: Widget[];
}

type DashboardDto = DashboardSummary & { widgets: unknown };

const toDashboard = (d: DashboardDto): Dashboard => ({ ...d, widgets: parseWidgets(d.widgets) });

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
      toDashboard(
        await instanceFetch<DashboardDto>(`/instance/dashboard?id=${encodeURIComponent(id!)}`),
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
      toDashboard(await instanceFetch<DashboardDto>(path, { method: 'POST', body: toBody(v) })),
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

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

export interface DashboardResponse {
  dashboard: DashboardSummary & { widgets: unknown };
}

// A dashboard as the instance endpoints return it ({ dashboard }), with its widgets
// parsed: anything this web app cannot render is dropped.
export function readDashboard(body: DashboardResponse): Dashboard {
  return { ...body.dashboard, widgets: parseWidgets(body.dashboard.widgets) };
}

import type { Widget } from './config';

// The ready-made dashboards offered by New dashboard. Each creates an ordinary
// dashboard the user can edit; the templates themselves are fixed here.
export interface DashboardTemplate {
  key: 'feedback' | 'delivery' | 'projects' | 'cycles' | 'bugs';
  name: string;
  description: string;
  widgets: (ctx: { bugLabelId: string | null }) => Widget[];
}

export const TEMPLATES: DashboardTemplate[] = [];

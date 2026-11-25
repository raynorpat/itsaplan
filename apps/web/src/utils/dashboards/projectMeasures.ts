import type { Adapter, ComputeContext, Item, Selection, SliceGroup, TableRow } from './compute';
import type { ProjectFilter, ProjectHealth, WidgetConfig } from './config';
import { projectHref } from './links';

// Projects as a widget's data: their state now (projects have no period).

export interface ProjectRow {
  id: string;
  name: string;
  // Linear's project status type: backlog, planned, started, paused, completed, canceled.
  status: string;
  leadId: string | null;
  leadName: string | null;
  teamIds: string[];
  labelIds: string[];
  // The health of the latest project update; null without one.
  health: ProjectHealth | null;
  // 0 to 1.
  progress: number;
  // "YYYY-MM-DD".
  targetDate: string | null;
}

const HEALTH: { key: string; label: string }[] = [
  { key: 'onTrack', label: 'On track' },
  { key: 'atRisk', label: 'At risk' },
  { key: 'offTrack', label: 'Off track' },
  { key: 'none', label: 'No update' },
];

const STATUSES: { key: string; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'planned', label: 'Planned' },
  { key: 'started', label: 'In progress' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Completed' },
  { key: 'canceled', label: 'Canceled' },
];

const DAY_MS = 86_400_000;

const labelIn = (list: { key: string; label: string }[], key: string) =>
  list.find((x) => x.key === key)?.label ?? key;

function matches(p: ProjectRow, raw: WidgetConfig['filter'], now: Date): boolean {
  const f = (Array.isArray(raw) ? {} : raw) as ProjectFilter;
  const any = (list: string[] | undefined, values: string[]) =>
    !list?.length || values.some((v) => list.includes(v));
  if (f.status?.length && !f.status.includes(p.status)) return false;
  if (!any(f.leadIds, p.leadId ? [p.leadId] : [])) return false;
  if (!any(f.teamIds, p.teamIds)) return false;
  if (!any(f.labelIds, p.labelIds)) return false;
  if (f.health?.length && !f.health.includes(p.health ?? 'none')) return false;
  if (f.targetWithinDays != null) {
    if (!p.targetDate) return false;
    const today = new Date(now).toISOString().slice(0, 10);
    const last = new Date(now.getTime() + f.targetWithinDays * DAY_MS).toISOString().slice(0, 10);
    if (p.targetDate < today || p.targetDate > last) return false;
  }
  return true;
}

function select(rows: ProjectRow[], measure: string): Selection<ProjectRow> {
  const item = (p: ProjectRow, value: number): Item<ProjectRow> => ({ row: p, rowId: p.id, value });
  if (measure === 'avgProgress')
    return { items: rows.map((p) => item(p, p.progress * 100)), excluded: 0 };
  if (measure === 'projects') return { items: rows.map((p) => item(p, 1)), excluded: 0 };
  return { items: [], excluded: 0 };
}

function slice(rows: ProjectRow[], field: string, ctx: ComputeContext): SliceGroup[] {
  const groups = (keysOf: (p: ProjectRow) => string[], order: { key: string; label: string }[]) =>
    order
      .map((o) => ({
        key: o.key,
        label: o.label,
        rowIds: new Set(rows.filter((p) => keysOf(p).includes(o.key)).map((p) => p.id)),
      }))
      .filter((g) => g.rowIds.size > 0);
  switch (field) {
    case 'health':
      return groups((p) => [p.health ?? 'none'], HEALTH);
    case 'status':
      return groups((p) => [p.status], STATUSES);
    case 'lead': {
      const leads = new Map<string, string>();
      for (const p of rows) leads.set(p.leadId ?? 'none', p.leadName ?? 'No lead');
      const order = [...leads]
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) =>
          a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label.localeCompare(b.label),
        );
      return groups((p) => [p.leadId ?? 'none'], order);
    }
    case 'team': {
      const ids = [...new Set(rows.flatMap((p) => p.teamIds))];
      const order = ids
        .map((id) => ({ key: id, label: ctx.insights.teams.get(id) ?? 'Unknown team' }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return groups((p) => p.teamIds, order);
    }
    default:
      return [];
  }
}

function table(items: Item<ProjectRow>[]): TableRow[] {
  return items.map(({ row: p }) => ({
    id: p.id,
    href: projectHref(p.id),
    cells: {
      name: p.name,
      status: labelIn(STATUSES, p.status),
      health: labelIn(HEALTH, p.health ?? 'none'),
      progress: Math.round(p.progress * 100),
      targetDate: p.targetDate,
      lead: p.leadName,
    },
  }));
}

export const projectAdapter: Adapter<ProjectRow> = {
  rows: (all) => all.projects ?? [],
  rowId: (p) => p.id,
  inTeam: (p, teamId) => p.teamIds.includes(teamId),
  matches,
  select: (rows, measure) => select(rows, measure),
  aggregate: (measure) => (measure === 'avgProgress' ? 'mean' : 'sum'),
  slice,
  table,
};

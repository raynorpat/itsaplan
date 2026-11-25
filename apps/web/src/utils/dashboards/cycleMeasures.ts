import type { Adapter, ComputeContext, Item, Selection, SliceGroup, TableRow } from './compute';
import type { CycleFilter, WidgetConfig } from './config';
import { cycleHref, dateCell } from './links';
import { inRange } from './periods';

// Cycles as a widget's data. A team's cycles are measured in its own unit (points or
// issues, the cycles' scope rule), so cycles of different teams are never added up.

export interface CycleRow {
  id: string;
  teamId: string;
  teamKey: string;
  number: number;
  name: string | null;
  startsAt: string;
  endsAt: string;
  // Set when the cycle closed.
  completedAt: string | null;
  unit: 'points' | 'issues';
  scope: number;
  completedScope: number;
  // Issues moved on when the cycle closed (Linear's uncompletedIssuesUponClose).
  carriedOver: number;
  // 0 to 1.
  progress: number;
}

// Ended cycles in a period: the last six of each team.
const RECENT_PER_TEAM = 6;

export const cycleLabel = (c: CycleRow): string =>
  `${c.teamKey} · ${c.name ?? `Cycle ${c.number}`}`;

function matches(c: CycleRow, raw: WidgetConfig['filter']): boolean {
  const f = (Array.isArray(raw) ? {} : raw) as CycleFilter;
  return !f.teamIds?.length || f.teamIds.includes(c.teamId);
}

function ended(rows: CycleRow[], from: Date, to: Date, now: Date): CycleRow[] {
  const byTeam = new Map<string, CycleRow[]>();
  for (const c of rows) {
    if (!inRange(c.endsAt, from, to) || new Date(c.endsAt).getTime() > now.getTime()) continue;
    byTeam.set(c.teamId, [...(byTeam.get(c.teamId) ?? []), c]);
  }
  return [...byTeam.values()].flatMap((list) =>
    list.sort((a, b) => b.endsAt.localeCompare(a.endsAt)).slice(0, RECENT_PER_TEAM),
  );
}

function select(
  rows: CycleRow[],
  measure: string,
  from: Date,
  to: Date,
  ctx: ComputeContext,
): Selection<CycleRow> {
  const item = (c: CycleRow, value: number): Item<CycleRow> => ({
    row: c,
    rowId: c.id,
    value,
    date: c.endsAt,
  });
  const now = ctx.now.getTime();
  switch (measure) {
    case 'completedScope':
      return {
        items: ended(rows, from, to, ctx.now).map((c) => item(c, c.completedScope)),
        excluded: 0,
      };
    case 'scope':
      return { items: ended(rows, from, to, ctx.now).map((c) => item(c, c.scope)), excluded: 0 };
    case 'carriedOver':
      return {
        items: ended(rows, from, to, ctx.now).map((c) => item(c, c.carriedOver)),
        excluded: 0,
      };
    case 'currentProgress':
      return {
        items: rows
          .filter(
            (c) =>
              !c.completedAt &&
              new Date(c.startsAt).getTime() <= now &&
              now < new Date(c.endsAt).getTime(),
          )
          .map((c) => ({ ...item(c, c.progress * 100), date: null })),
        excluded: 0,
      };
    default:
      return { items: [], excluded: 0 };
  }
}

function slice(rows: CycleRow[], field: string, ctx: ComputeContext): SliceGroup[] {
  if (field === 'cycle')
    return [...rows]
      .sort(
        (a, b) =>
          a.teamKey.localeCompare(b.teamKey) ||
          a.startsAt.localeCompare(b.startsAt) ||
          a.number - b.number,
      )
      .map((c) => ({ key: c.id, label: cycleLabel(c), rowIds: new Set([c.id]) }));
  if (field === 'team') {
    const teams = new Map<string, { key: string; label: string; rowIds: Set<string> }>();
    for (const c of rows) {
      const g = teams.get(c.teamId) ?? {
        key: c.teamId,
        label: ctx.insights.teams.get(c.teamId) ?? c.teamKey,
        rowIds: new Set<string>(),
      };
      g.rowIds.add(c.id);
      teams.set(c.teamId, g);
    }
    return [...teams.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  return [];
}

function table(items: Item<CycleRow>[]): TableRow[] {
  return items.map(({ row: c }) => ({
    id: c.id,
    href: cycleHref(c.teamKey, c.number),
    cells: {
      team: c.teamKey,
      cycle: c.name ?? `Cycle ${c.number}`,
      startsAt: dateCell(c.startsAt),
      endsAt: dateCell(c.endsAt),
      scope: c.scope,
      completedScope: c.completedScope,
      carriedOver: c.carriedOver,
      progress: Math.round(c.progress * 100),
    },
  }));
}

export const cycleAdapter: Adapter<CycleRow> = {
  rows: (all) => all.cycles ?? [],
  rowId: (c) => c.id,
  inTeam: (c, teamId) => c.teamId === teamId,
  matches: (c, filter) => matches(c, filter),
  select,
  aggregate: (measure) => (measure === 'currentProgress' ? 'mean' : 'sum'),
  slice,
  table,
  teams: (rows) => new Set(rows.map((c) => c.teamId)),
  scopeUnit: (rows) => rows[0]?.unit ?? 'issues',
};

import type { ProjectHealth, ProjectStatus } from '@/types/project';
import { STATUS_META, STATUS_ORDER } from '@/utils/projectMeta';
import { addDays, parseDate, toDateStr } from '@/utils/dates';
import { dragDates, GROUP_H, ROW_H, type DateDragMode } from '@/utils/timelineScale';

// The projects timeline's layout: which projects show in which group, where each row
// sits, and the date changes a drag makes. Dates are calendar days ("YYYY-MM-DD").

export interface TimelineMilestone {
  id: string;
  name: string;
  targetDate: string | null;
}

export interface TimelineProject {
  id: string;
  name: string;
  status: ProjectStatus;
  health: ProjectHealth | null;
  startDate: string | null;
  targetDate: string | null;
  leadUserId: string | null;
  teams: { id: string; name: string }[];
  initiatives: { id: string; name: string }[];
  milestones: TimelineMilestone[];
}

export type ProjectGrouping = 'none' | 'status' | 'team' | 'lead' | 'initiative';

export const PROJECT_GROUPINGS: { value: ProjectGrouping; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'team', label: 'Team' },
  { value: 'lead', label: 'Lead' },
  { value: 'initiative', label: 'Initiative' },
];

// One appearance of a project in a group. A project with several teams or initiatives
// appears once per group; `copyIndex` counts its earlier appearances (0 = top-most).
export interface TimelineRowRef {
  projectId: string;
  copyIndex: number;
}

export interface TimelineGroup {
  key: string;
  label: string;
  rows: TimelineRowRef[];
}

export interface ProjectTimelineLayout {
  groups: TimelineGroup[];
  // Projects with neither a start nor a target date, in the given order.
  noDates: string[];
}

interface GroupKey {
  key: string;
  label: string;
}

const NONE_KEY = 'none';

function groupKeysOf(
  p: TimelineProject,
  grouping: ProjectGrouping,
  leadName: (id: string) => string,
): GroupKey[] {
  switch (grouping) {
    case 'none':
      return [{ key: 'all', label: 'All projects' }];
    case 'status':
      return [{ key: p.status, label: STATUS_META[p.status].label }];
    case 'lead':
      return p.leadUserId
        ? [{ key: p.leadUserId, label: leadName(p.leadUserId) }]
        : [{ key: NONE_KEY, label: 'No lead' }];
    case 'team':
      return p.teams.length > 0
        ? p.teams.map((t) => ({ key: t.id, label: t.name }))
        : [{ key: NONE_KEY, label: 'No team' }];
    case 'initiative':
      return p.initiatives.length > 0
        ? p.initiatives.map((i) => ({ key: i.id, label: i.name }))
        : [{ key: NONE_KEY, label: 'No initiative' }];
  }
}

// Status groups follow the lifecycle; the others sort by name, with the "No …"
// group last.
function compareGroups(grouping: ProjectGrouping) {
  return (a: GroupKey, b: GroupKey): number => {
    if (grouping === 'status')
      return (
        STATUS_ORDER.indexOf(a.key as ProjectStatus) - STATUS_ORDER.indexOf(b.key as ProjectStatus)
      );
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return a.label.localeCompare(b.label);
  };
}

export function buildProjectTimeline(
  projects: TimelineProject[],
  { grouping, leadName }: { grouping: ProjectGrouping; leadName: (id: string) => string },
): ProjectTimelineLayout {
  const noDates: string[] = [];
  const groups = new Map<string, GroupKey & { ids: string[] }>();
  for (const p of projects) {
    if (!p.startDate && !p.targetDate) {
      noDates.push(p.id);
      continue;
    }
    for (const g of groupKeysOf(p, grouping, leadName)) {
      const group = groups.get(g.key) ?? { ...g, ids: [] };
      group.ids.push(p.id);
      groups.set(g.key, group);
    }
  }
  const copies = new Map<string, number>();
  const ordered = [...groups.values()].sort(compareGroups(grouping));
  return {
    groups: ordered.map((g) => ({
      key: g.key,
      label: g.label,
      rows: g.ids.map((projectId) => {
        const copyIndex = copies.get(projectId) ?? 0;
        copies.set(projectId, copyIndex + 1);
        return { projectId, copyIndex };
      }),
    })),
    noDates,
  };
}

// The days a project's bar covers. A project with one of the two dates is a point on
// that date.
export function projectSpan(p: {
  startDate: string | null;
  targetDate: string | null;
}): { start: Date; end: Date; point: boolean } | null {
  const start = parseDate(p.startDate);
  const end = parseDate(p.targetDate);
  if (start && end) return { start, end: end < start ? start : end, point: false };
  const only = start ?? end;
  return only ? { start: only, end: only, point: true } : null;
}

export interface ProjectDates {
  startDate: string | null;
  targetDate: string | null;
}

// The dates after dragging a bar `deltaDays` days: `move` shifts both (a missing date
// stays missing), `start` / `end` change one end without passing the other.
export function shiftProjectDates(
  dates: ProjectDates,
  mode: DateDragMode,
  deltaDays: number,
): ProjectDates {
  const start = parseDate(dates.startDate);
  const end = parseDate(dates.targetDate);
  if (!start || !end) {
    const shift = (d: Date | null) => (d ? toDateStr(addDays(d, deltaDays)) : null);
    return { startDate: shift(start), targetDate: shift(end) };
  }
  const next = dragDates({ mode, start, end, deltaDays });
  return { startDate: toDateStr(next.start), targetDate: toDateStr(next.end) };
}

// Dates for a project without dates dropped on a day: it starts that day and targets
// two weeks later.
export const DROP_LENGTH_DAYS = 14;

export function dropDates(day: Date): ProjectDates {
  return { startDate: toDateStr(day), targetDate: toDateStr(addDays(day, DROP_LENGTH_DAYS)) };
}

export type TimelineRow =
  | {
      kind: 'group';
      groupKey: string;
      label: string;
      count: number;
      collapsed: boolean;
      top: number;
    }
  | { kind: 'project'; groupKey: string; projectId: string; copyIndex: number; top: number };

// The rows in display order with their top offset under the header. Group headers are
// left out without grouping; a collapsed group keeps its header and hides its rows.
export function flattenTimelineRows(
  layout: ProjectTimelineLayout,
  { collapsed, headers }: { collapsed: Set<string>; headers: boolean },
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let top = 0;
  for (const g of layout.groups) {
    const isCollapsed = headers && collapsed.has(g.key);
    if (headers) {
      rows.push({
        kind: 'group',
        groupKey: g.key,
        label: g.label,
        count: g.rows.length,
        collapsed: isCollapsed,
        top,
      });
      top += GROUP_H;
    }
    if (isCollapsed) continue;
    for (const r of g.rows) {
      rows.push({ kind: 'project', groupKey: g.key, ...r, top });
      top += ROW_H;
    }
  }
  return rows;
}

// Where a project's anchors sit on the track, for the dependency arrows: `y` is the
// middle of its top-most visible row (px under the header), `startX` the left edge of
// its start day, `endX` the right edge of its target day, and each dated milestone the
// middle of its day. A project with one date has both anchors on that day.
export interface ProjectPosition {
  y: number;
  startX: number;
  endX: number;
  milestoneX: Map<string, number>;
}

export type ProjectPositions = Map<string, ProjectPosition>;

export function projectPositions(
  rows: TimelineRow[],
  projects: Map<string, TimelineProject>,
  xOf: (date: Date) => number,
  dayW: number,
): ProjectPositions {
  const positions: ProjectPositions = new Map();
  for (const row of rows) {
    if (row.kind !== 'project' || positions.has(row.projectId)) continue;
    const p = projects.get(row.projectId);
    const span = p && projectSpan(p);
    if (!p || !span) continue;
    const milestoneX = new Map<string, number>();
    for (const m of p.milestones) {
      const day = parseDate(m.targetDate);
      if (day) milestoneX.set(m.id, xOf(day) + dayW / 2);
    }
    positions.set(p.id, {
      y: row.top + ROW_H / 2,
      startX: xOf(span.start),
      endX: xOf(span.end) + dayW,
      milestoneX,
    });
  }
  return positions;
}

// The earliest and latest dates on the timeline (bars and milestones), for its range.
export function timelineRange(projects: TimelineProject[]): { from: Date | null; to: Date | null } {
  let from: Date | null = null;
  let to: Date | null = null;
  const take = (d: Date | null) => {
    if (!d) return;
    if (!from || d < from) from = d;
    if (!to || d > to) to = d;
  };
  for (const p of projects) {
    take(parseDate(p.startDate));
    take(parseDate(p.targetDate));
    for (const m of p.milestones) take(parseDate(m.targetDate));
  }
  return { from, to };
}

// How many days a milestone diamond moved, applied to its target date.
export function shiftDate(date: string, deltaDays: number): string {
  const day = parseDate(date);
  return day ? toDateStr(addDays(day, deltaDays)) : date;
}

// The height of the rows, for a layer drawn over them.
export function rowsHeight(rows: TimelineRow[]): number {
  const last = rows.at(-1);
  if (!last) return 0;
  return last.top + (last.kind === 'group' ? GROUP_H : ROW_H);
}

// A project as it shows while dragged: its bar at the preview days (a one-date
// project keeps one date) and any dragged milestone at its preview day.
export function withPreview(
  p: TimelineProject,
  bar: { start: Date; end: Date } | null,
  milestoneDay: (milestoneId: string) => Date | null,
): TimelineProject {
  const milestones = p.milestones.map((m) => {
    const day = milestoneDay(m.id);
    return day ? { ...m, targetDate: toDateStr(day) } : m;
  });
  if (!bar) return { ...p, milestones };
  return {
    ...p,
    startDate: p.startDate || !p.targetDate ? toDateStr(bar.start) : null,
    targetDate: p.targetDate ? toDateStr(bar.end) : null,
    milestones,
  };
}

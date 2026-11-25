import { startOfDay } from 'date-fns';
import type { Issue } from '@/types/issue';
import type { TeamDetail } from '@/types/team';
import { parseDate } from '@/utils/dates';
import { buildGroups, groupIssues, type IssueGroup } from '@/utils/team';
import { timelineScale, type MonthLabel } from '@/utils/timelineScale';
import type { GroupField, TimelineScale } from '@/utils/viewSettings';

// An issue's bar span. Effective start is when work on it started (startedAt), or
// its creation date when it has not started (inferredStart), so every issue has a
// bar. Effective end is the due date, or the start when there is
// no due date (a single-day marker).
export interface Span {
  start: Date;
  end: Date;
  inferredStart: boolean;
}

export function effSpan(issue: Issue): Span {
  const created = startOfDay(new Date(issue.createdAt));
  const startRaw = issue.startedAt ? startOfDay(new Date(issue.startedAt)) : null;
  const dueRaw = parseDate(issue.dueDate);
  let start = startRaw ?? created;
  const end = dueRaw ?? start;
  if (end < start) start = end; // a due date before the start collapses the bar to a single day
  return { start, end, inferredStart: startRaw == null };
}

// A flat render list so the left labels and the right tracks share the exact
// same row order and heights: one entry per state group header, then its issues.
export type TimelineRow =
  | {
      kind: 'group';
      group: IssueGroup;
      count: number;
      collapsed: boolean;
      aggregateSpan: Span | null;
    }
  | { kind: 'issue'; issue: Issue; span: Span; groupKey: string };

// The whole timeline layout derived from the team and the current viewport:
// the flattened rows, the day columns and their month labels, the track width
// (extended with trailing days so it always fills the viewport), the today
// marker, the gridline background, and a helper to place a span's bar.
export interface TimelineModel {
  rows: TimelineRow[];
  days: Date[];
  months: MonthLabel[];
  trackWidth: number;
  todayLeft: number;
  todayInRange: boolean;
  dayLines: { backgroundImage: string };
  spanToRect: (start: Date, end: Date) => { left: number; width: number };
}

export function buildTimeline({
  team,
  group,
  showEmptyGroups,
  collapsedGroups,
  viewportW,
  labelW,
  zoom,
}: {
  team: TeamDetail;
  group: GroupField;
  showEmptyGroups: boolean;
  collapsedGroups: Set<string>;
  viewportW: number;
  labelW: number;
  zoom: TimelineScale;
}): TimelineModel {
  const groups = buildGroups(team, group);
  const issuesByGroup = groupIssues(groups, team.issues, group);
  // Rows, and the date range that covers every bar (plus padding and today).
  const rows: TimelineRow[] = [];
  const today = startOfDay(new Date());
  let min: Date | null = null;
  let max: Date | null = null;
  for (const issueGroup of groups) {
    const issues = issuesByGroup.get(issueGroup.key) ?? [];
    if (!showEmptyGroups && issues.length === 0) continue;
    const issueRows = issues.map((issue) => ({ issue, span: effSpan(issue) }));
    let groupStart: Date | null = null;
    let groupEnd: Date | null = null;
    for (const { span } of issueRows) {
      if (!groupStart || span.start < groupStart) groupStart = span.start;
      if (!groupEnd || span.end > groupEnd) groupEnd = span.end;
      if (!min || span.start < min) min = span.start;
      if (!max || span.end > max) max = span.end;
    }
    const aggregateSpan =
      groupStart && groupEnd ? { start: groupStart, end: groupEnd, inferredStart: false } : null;
    const collapsed = collapsedGroups.has(issueGroup.key);
    rows.push({ kind: 'group', group: issueGroup, count: issues.length, collapsed, aggregateSpan });
    if (collapsed) continue;
    for (const { issue, span } of issueRows) {
      rows.push({ kind: 'issue', issue, span, groupKey: issueGroup.key });
    }
  }

  const { days, months, trackWidth, todayLeft, todayInRange, dayLines, spanToRect } = timelineScale(
    { from: min, to: max, zoom, viewportW, labelW, today },
  );

  return { rows, days, months, trackWidth, todayLeft, todayInRange, dayLines, spanToRect };
}

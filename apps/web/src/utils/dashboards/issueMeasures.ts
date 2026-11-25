import { priorityLabel } from '@/utils/fieldOptions';
import { sliceIssues, type InsightIssue, type SliceField } from '@/utils/insights/slices';
import type { Adapter, ComputeContext, Item, Selection, TableRow } from './compute';
import { dateCell, issueHref } from './links';
import { daysBetween, inRange } from './periods';

// Issues as a widget's data: the Insights panel's issues and slices, with each
// measure tied to a time basis (config.ts).

const isOpen = (i: InsightIssue) => !i.completedAt && !i.canceledAt;

function select(
  issues: InsightIssue[],
  measure: string,
  from: Date,
  to: Date,
  ctx: ComputeContext,
): Selection<InsightIssue> {
  const item = (i: InsightIssue, value = 1, date: string | null = null): Item<InsightIssue> => ({
    row: i,
    rowId: i.id,
    value,
    date,
  });
  const completedIn = issues.filter((i) => inRange(i.completedAt, from, to));
  switch (measure) {
    case 'open':
      return { items: issues.filter(isOpen).map((i) => item(i)), excluded: 0 };
    case 'openPoints':
      return { items: issues.filter(isOpen).map((i) => item(i, i.estimate ?? 1)), excluded: 0 };
    case 'created':
      return {
        items: issues
          .filter((i) => inRange(i.createdAt, from, to))
          .map((i) => item(i, 1, i.createdAt)),
        excluded: 0,
      };
    case 'completed':
      return { items: completedIn.map((i) => item(i, 1, i.completedAt)), excluded: 0 };
    case 'completedPoints':
      return {
        items: completedIn.map((i) => item(i, i.estimate ?? 1, i.completedAt)),
        excluded: 0,
      };
    case 'cycleTime':
      return {
        items: completedIn
          .filter((i) => i.startedAt)
          .map((i) => item(i, daysBetween(i.startedAt!, i.completedAt!), i.completedAt)),
        excluded: completedIn.filter((i) => !i.startedAt).length,
      };
    case 'leadTime':
      return {
        items: completedIn.map((i) =>
          item(i, daysBetween(i.createdAt, i.completedAt!), i.completedAt),
        ),
        excluded: 0,
      };
    case 'age':
      return {
        items: issues
          .filter(isOpen)
          .map((i) => item(i, daysBetween(i.createdAt, ctx.now.getTime()))),
        excluded: 0,
      };
    case 'requests':
      return {
        items: issues.filter(isOpen).map((i) => item(i, i.requests?.count ?? 0)),
        excluded: 0,
      };
    case 'requesters':
      return {
        items: issues
          .filter(isOpen)
          .flatMap((i) => (i.requests?.requesterIds ?? []).map((p) => ({ ...item(i), key: p }))),
        excluded: 0,
      };
    default:
      return { items: [], excluded: 0 };
  }
}

function table(
  items: Item<InsightIssue>[],
  _rows: InsightIssue[],
  ctx: ComputeContext,
): TableRow[] {
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const { row: i } of items) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push({
      id: i.id,
      href: issueHref(i.identifier),
      cells: {
        identifier: i.identifier,
        title: i.title,
        status: ctx.insights.states.get(i.stateId)?.name ?? null,
        assignee: i.assigneeUserId ? (ctx.insights.users.get(i.assigneeUserId) ?? null) : null,
        priority: priorityLabel(i.priority || 0),
        estimate: i.estimate ?? null,
        requests: i.requests?.count ?? 0,
        people: i.requests?.requesterIds.length ?? 0,
        createdAt: dateCell(i.createdAt),
        completedAt: dateCell(i.completedAt),
        ageDays: isOpen(i) ? Math.floor(daysBetween(i.createdAt, ctx.now.getTime())) : null,
      },
    });
  }
  return out;
}

export const issueAdapter: Adapter<InsightIssue> = {
  rows: (all) => all.issues ?? [],
  rowId: (i) => i.id,
  inTeam: (i, teamId) => i.teamId === teamId,
  // The view filter is applied when the issues are fetched.
  matches: () => true,
  select,
  aggregate: (measure) => {
    if (measure === 'cycleTime' || measure === 'leadTime' || measure === 'age') return 'median';
    if (measure === 'requesters') return 'distinct';
    return 'sum';
  },
  slice: (issues, field, ctx) =>
    sliceIssues(issues, field as SliceField, ctx.insights).map((s) => ({
      key: s.key,
      label: s.label,
      rowIds: new Set(s.issues.map((i) => i.id)),
    })),
  table,
};

import { sliceIssues, type InsightIssue, type SliceField } from '@/utils/insights/slices';
import { customerKey } from '@/utils/requests';
import type { Adapter, ComputeContext, Item, Selection, SliceGroup, TableRow } from './compute';
import { dateCell, issueHref } from './links';
import { daysBetween, inRange } from './periods';

// Feedback requests (project 1's CustomerNeed) as a widget's data. A request belongs
// to an issue; measures of time count each issue once, from its first request.

export type RequestSource = 'team' | 'portal' | 'form';

export interface RequestCustomer {
  id: string;
  name: string;
  revenue: number | null;
  tier: { id: string; name: string; position: number } | null;
  status: { id: string; name: string; position: number };
}

export interface RequestRow {
  id: string;
  createdAt: string;
  important: boolean;
  source: RequestSource;
  requesterId: string | null;
  // Null while Customers is off or the request has no customer.
  customer: RequestCustomer | null;
  // The issue is archived (auto-archive archives closed issues): its requests still
  // count for what happened in a period, not for the current state.
  issueArchived: boolean;
  issue: InsightIssue;
}

const SOURCES: { key: RequestSource; label: string }[] = [
  { key: 'team', label: 'Logged by team' },
  { key: 'portal', label: 'Portal' },
  { key: 'form', label: 'Form' },
];

const isOpen = (i: InsightIssue) => !i.completedAt && !i.canceledAt;

interface IssueRequests {
  issue: InsightIssue;
  rows: RequestRow[];
  // The earliest request, which starts the issue's clock.
  first: RequestRow;
}

function byIssue(rows: RequestRow[]): IssueRequests[] {
  const out = new Map<string, IssueRequests>();
  for (const r of rows) {
    const entry = out.get(r.issue.id);
    if (!entry) out.set(r.issue.id, { issue: r.issue, rows: [r], first: r });
    else {
      entry.rows.push(r);
      if (r.createdAt < entry.first.createdAt) entry.first = r;
    }
  }
  return [...out.values()];
}

function select(
  rows: RequestRow[],
  measure: string,
  from: Date,
  to: Date,
  ctx: ComputeContext,
): Selection<RequestRow> {
  const item = (r: RequestRow, value = 1, extra: Partial<Item<RequestRow>> = {}) => ({
    row: r,
    rowId: r.id,
    value,
    date: r.createdAt,
    ...extra,
  });
  const inPeriod = rows.filter((r) => inRange(r.createdAt, from, to));
  const issues = byIssue(rows);
  // An issue-level item stands for the issue through its first request.
  const issueItem = (g: IssueRequests, value: number, date: string | null) =>
    item(g.first, value, { date });
  switch (measure) {
    case 'requests':
      return { items: inPeriod.map((r) => item(r)), excluded: 0 };
    case 'people':
      return { items: inPeriod.map((r) => item(r, 1, { key: r.requesterId })), excluded: 0 };
    case 'customers':
      return {
        items: inPeriod.map((r) =>
          item(r, 1, {
            key: customerKey({ id: r.id, requesterId: r.requesterId, customerId: r.customer?.id }),
          }),
        ),
        excluded: 0,
      };
    case 'newPeople':
      return {
        items: inPeriod
          .filter((r) => r.requesterId && inRange(ctx.firstFeedback.get(r.requesterId), from, to))
          .map((r) => item(r, 1, { key: r.requesterId })),
        excluded: 0,
      };
    case 'importantShare':
      return { items: inPeriod.map((r) => item(r, r.important ? 1 : 0)), excluded: 0 };
    case 'timeToStart': {
      const items: Item<RequestRow>[] = [];
      let excluded = 0;
      for (const g of issues) {
        if (inRange(g.issue.startedAt, from, to)) {
          const days = daysBetween(g.first.createdAt, g.issue.startedAt!);
          if (days < 0) excluded += 1;
          else items.push(issueItem(g, days, g.issue.startedAt));
        } else if (!g.issue.startedAt && inRange(g.issue.completedAt, from, to)) excluded += 1;
      }
      return { items, excluded };
    }
    case 'timeToDone': {
      const items: Item<RequestRow>[] = [];
      let excluded = 0;
      for (const g of issues) {
        if (!inRange(g.issue.completedAt, from, to)) continue;
        const days = daysBetween(g.first.createdAt, g.issue.completedAt!);
        if (days < 0) excluded += 1;
        else items.push(issueItem(g, days, g.issue.completedAt));
      }
      return { items, excluded };
    }
    case 'delivered':
      return {
        items: issues
          .filter((g) => inRange(g.issue.completedAt, from, to))
          .map((g) => issueItem(g, 1, g.issue.completedAt)),
        excluded: 0,
      };
    case 'deliveredPeople':
      return {
        items: issues
          .filter((g) => inRange(g.issue.completedAt, from, to))
          .flatMap((g) =>
            g.rows.map((r) => item(r, 1, { key: r.requesterId, date: g.issue.completedAt })),
          ),
        excluded: 0,
      };
    case 'waiting':
      return {
        items: issues
          .filter((g) => isOpen(g.issue) && !g.first.issueArchived)
          .map((g) => issueItem(g, daysBetween(g.first.createdAt, ctx.now.getTime()), null)),
        excluded: 0,
      };
    default:
      return { items: [], excluded: 0 };
  }
}

interface CustomerGroup {
  key: string;
  label: string;
  order: number;
}

// The customer, tier or customer status of a request; requests without one last.
function customerGroup(r: RequestRow, field: string): CustomerGroup {
  const c = r.customer;
  if (field === 'customer')
    return c
      ? { key: c.id, label: c.name, order: 0 }
      : { key: 'none', label: 'No customer', order: Infinity };
  if (field === 'tier')
    return c?.tier
      ? { key: c.tier.id, label: c.tier.name, order: c.tier.position }
      : { key: 'none', label: 'No tier', order: Infinity };
  return c
    ? { key: c.status.id, label: c.status.name, order: c.status.position }
    : { key: 'none', label: 'No customer', order: Infinity };
}

function customerSlice(rows: RequestRow[], field: string): SliceGroup[] {
  const groups = new Map<string, CustomerGroup & { rowIds: Set<string> }>();
  for (const r of rows) {
    const g = customerGroup(r, field);
    const entry = groups.get(g.key) ?? { ...g, rowIds: new Set<string>() };
    entry.rowIds.add(r.id);
    groups.set(g.key, entry);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, rowIds }) => ({ key, label, rowIds }));
}

function slice(rows: RequestRow[], field: string, ctx: ComputeContext): SliceGroup[] {
  if (field === 'customer' || field === 'tier' || field === 'customerStatus')
    return customerSlice(rows, field);
  const groups = (keyOf: (r: RequestRow) => string, order: { key: string; label: string }[]) =>
    order
      .map((o) => ({
        key: o.key,
        label: o.label,
        rowIds: new Set(rows.filter((r) => keyOf(r) === o.key).map((r) => r.id)),
      }))
      .filter((g) => g.rowIds.size > 0);
  if (field === 'source') return groups((r) => r.source, SOURCES);
  if (field === 'important')
    return groups(
      (r) => (r.important ? 'important' : 'normal'),
      [
        { key: 'important', label: 'Important' },
        { key: 'normal', label: 'Not important' },
      ],
    );
  // Issue fields: group the issues, then their requests.
  const issues = byIssue(rows);
  return sliceIssues(
    issues.map((g) => g.issue),
    field as SliceField,
    ctx.insights,
  ).map((s) => {
    const ids = new Set(s.issues.map((i) => i.id));
    return {
      key: s.key,
      label: s.label,
      rowIds: new Set(rows.filter((r) => ids.has(r.issue.id)).map((r) => r.id)),
    };
  });
}

// One row per issue the items touch, with the issue's full request picture.
function table(items: Item<RequestRow>[], rows: RequestRow[], ctx: ComputeContext): TableRow[] {
  const all = new Map(byIssue(rows).map((g) => [g.issue.id, g]));
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const { row } of items) {
    const g = all.get(row.issue.id);
    if (!g || seen.has(g.issue.id)) continue;
    seen.add(g.issue.id);
    const last = g.rows.reduce((a, r) => (r.createdAt > a ? r.createdAt : a), g.first.createdAt);
    out.push({
      id: g.issue.id,
      href: issueHref(g.issue.identifier),
      cells: {
        identifier: g.issue.identifier,
        title: g.issue.title,
        status: ctx.insights.states.get(g.issue.stateId)?.name ?? null,
        people: new Set(g.rows.map((r) => r.requesterId).filter(Boolean)).size,
        customers: new Set(
          g.rows.map((r) =>
            customerKey({ id: r.id, requesterId: r.requesterId, customerId: r.customer?.id }),
          ),
        ).size,
        requests: g.rows.length,
        important: g.rows.filter((r) => r.important).length,
        firstRequestAt: dateCell(g.first.createdAt),
        lastRequestAt: dateCell(last),
        waitingDays: isOpen(g.issue)
          ? Math.floor(daysBetween(g.first.createdAt, ctx.now.getTime()))
          : null,
      },
    });
  }
  return out;
}

export const requestAdapter: Adapter<RequestRow> = {
  rows: (all) => all.requests ?? [],
  rowId: (r) => r.id,
  inTeam: (r, teamId) => r.issue.teamId === teamId,
  // The view filter is applied when the requests are fetched.
  matches: () => true,
  select,
  aggregate: (measure) => {
    if (
      measure === 'people' ||
      measure === 'customers' ||
      measure === 'newPeople' ||
      measure === 'deliveredPeople'
    )
      return 'distinct';
    if (measure === 'timeToStart' || measure === 'timeToDone' || measure === 'waiting')
      return 'median';
    if (measure === 'importantShare') return 'share';
    return 'sum';
  },
  slice,
  table,
};

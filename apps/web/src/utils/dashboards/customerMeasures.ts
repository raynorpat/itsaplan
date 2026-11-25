import type { Adapter, Item, Selection, SliceGroup, TableRow } from './compute';
import type { CustomerFilter, WidgetConfig } from './config';
import { customerHref } from './links';

// Customers as a widget's data: their state now (customers have no period and no
// team, so the dashboard's team leaves them all in).

export interface CustomerRow {
  id: string;
  slugId: string;
  name: string;
  statusId: string;
  statusName: string;
  statusPosition: number;
  tierId: string | null;
  tierName: string | null;
  tierPosition: number | null;
  ownerId: string | null;
  ownerName: string | null;
  revenue: number | null;
  // The issues the customer's people asked for (Linear's approximateNeedCount).
  requests: number;
  createdAt: string;
}

function matches(c: CustomerRow, raw: WidgetConfig['filter']): boolean {
  const f = (Array.isArray(raw) ? {} : raw) as CustomerFilter;
  if (f.statusIds?.length && !f.statusIds.includes(c.statusId)) return false;
  if (f.tierIds?.length && !(c.tierId && f.tierIds.includes(c.tierId))) return false;
  return true;
}

function select(rows: CustomerRow[], measure: string): Selection<CustomerRow> {
  const item = (c: CustomerRow, value: number): Item<CustomerRow> => ({
    row: c,
    rowId: c.id,
    value,
  });
  switch (measure) {
    case 'customers':
      return { items: rows.map((c) => item(c, 1)), excluded: 0 };
    case 'revenue':
      return { items: rows.map((c) => item(c, c.revenue ?? 0)), excluded: 0 };
    case 'requests':
      return { items: rows.map((c) => item(c, c.requests)), excluded: 0 };
    default:
      return { items: [], excluded: 0 };
  }
}

interface Group {
  key: string;
  label: string;
  order: number;
}

// Groups in their field's order (statuses and tiers by position, owners by name),
// with the group of customers without the field last.
function slice(rows: CustomerRow[], field: string): SliceGroup[] {
  const groupOf = (c: CustomerRow): Group => {
    if (field === 'status')
      return { key: c.statusId, label: c.statusName, order: c.statusPosition };
    if (field === 'tier')
      return c.tierId
        ? { key: c.tierId, label: c.tierName ?? '', order: c.tierPosition ?? 0 }
        : { key: 'none', label: 'No tier', order: Infinity };
    return c.ownerId
      ? { key: c.ownerId, label: c.ownerName ?? '', order: 0 }
      : { key: 'none', label: 'No owner', order: Infinity };
  };
  const groups = new Map<string, Group & { rowIds: Set<string> }>();
  for (const c of rows) {
    const g = groupOf(c);
    const entry = groups.get(g.key) ?? { ...g, rowIds: new Set<string>() };
    entry.rowIds.add(c.id);
    groups.set(g.key, entry);
  }
  return [...groups.values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
    .map(({ key, label, rowIds }) => ({ key, label, rowIds }));
}

function table(items: Item<CustomerRow>[]): TableRow[] {
  const seen = new Set<string>();
  const out: TableRow[] = [];
  for (const { row: c } of items) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push({
      id: c.id,
      href: customerHref(c.slugId),
      cells: {
        name: c.name,
        status: c.statusName,
        tier: c.tierName,
        owner: c.ownerName,
        revenue: c.revenue,
        requests: c.requests,
      },
    });
  }
  return out;
}

export const customerAdapter: Adapter<CustomerRow> = {
  rows: (all) => all.customers ?? [],
  rowId: (c) => c.id,
  inTeam: () => true,
  matches,
  select,
  aggregate: () => 'sum',
  slice,
  table,
};

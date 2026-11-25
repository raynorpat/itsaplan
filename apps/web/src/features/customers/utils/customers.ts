import type { StateType } from '@/types/team';

export type CustomerSortKey = 'name' | 'requests' | 'revenue';
export type SortDir = 'asc' | 'desc';

export interface CustomerSortRow {
  name: string;
  requests: number;
  revenue: number | null;
}

// The Customers list in the chosen order. Customers without revenue come last in both
// directions, as Linear lists empty values.
export function sortCustomers<T extends CustomerSortRow>(
  rows: readonly T[],
  key: CustomerSortKey,
  dir: SortDir,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'name')
      return sign * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sign * (av - bv);
  });
}

// Revenue in the workspace currency, compact ("$1.3M"); a dash without revenue.
export function formatRevenue(value: number | null, currency: string): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export interface CustomerNeedIssue {
  id: string;
  identifier: string;
  title: string;
  state: { name: string; type: StateType; color: string };
}

export interface CustomerIssueGroup {
  issue: CustomerNeedIssue;
  requests: number;
  important: number;
  lastAt: string;
}

// A customer's requests grouped by issue: most requests first, then the latest request.
export function issuesOfCustomer(
  needs: readonly { issue: CustomerNeedIssue | null; priority: number; createdAt: string }[],
): CustomerIssueGroup[] {
  const groups = new Map<string, CustomerIssueGroup>();
  for (const need of needs) {
    if (!need.issue) continue;
    const group = groups.get(need.issue.id) ?? {
      issue: need.issue,
      requests: 0,
      important: 0,
      lastAt: need.createdAt,
    };
    group.requests += 1;
    if (need.priority >= 1) group.important += 1;
    if (need.createdAt > group.lastAt) group.lastAt = need.createdAt;
    groups.set(need.issue.id, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.requests - a.requests || b.lastAt.localeCompare(a.lastAt),
  );
}

// Domains typed into one field, separated by commas, spaces or new lines. The API
// lowercases and checks them; this only splits and drops empties and repeats.
export function parseDomains(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,]+/)) {
    const domain = part.trim().toLowerCase();
    if (domain) seen.add(domain);
  }
  return [...seen];
}

// A revenue or size field: null when empty, the whole number typed (thousands
// separators allowed), or undefined when it is not a whole nonnegative number.
export function parseWholeNumber(text: string): number | null | undefined {
  const cleaned = text.trim().replaceAll(',', '');
  if (!cleaned) return null;
  if (!/^\d+$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

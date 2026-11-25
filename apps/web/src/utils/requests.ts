import type { Issue, RequestSummary } from '@/types/issue';

// Requests (feedback) on issue lists: a summary per issue built from the team's
// feedback items, attached to the board's issues for the Requests display property,
// filter, ordering and Insights.

export interface NeedRef {
  id?: string;
  issueId: string;
  priority: number;
  requesterId: string | null;
  // Null while Customers is off or the request has no customer.
  customerId?: string | null;
  customerRevenue?: number | null;
}

// What the customer count counts for one request (the server's customerCountSql).
export function customerKey(n: Pick<NeedRef, 'id' | 'requesterId' | 'customerId'>): string {
  if (n.customerId) return `c:${n.customerId}`;
  if (n.requesterId) return `p:${n.requesterId}`;
  return `n:${n.id ?? ''}`;
}

interface Building {
  count: number;
  people: Set<string>;
  important: Set<string>;
  customers: Set<string>;
  revenue: Record<string, number>;
}

// One summary per issue that has feedback. Feedback without a requester counts as an
// item but not as a person, as on the server.
export function summarizeNeeds(needs: readonly NeedRef[]): Map<string, RequestSummary> {
  const out = new Map<string, Building>();
  for (const n of needs) {
    let s = out.get(n.issueId);
    if (!s) {
      s = { count: 0, people: new Set(), important: new Set(), customers: new Set(), revenue: {} };
      out.set(n.issueId, s);
    }
    s.count += 1;
    s.customers.add(customerKey(n));
    if (n.customerId && n.customerRevenue != null) s.revenue[n.customerId] = n.customerRevenue;
    if (n.requesterId) {
      s.people.add(n.requesterId);
      if (n.priority === 1) s.important.add(n.requesterId);
    }
  }
  return new Map(
    [...out].map(([id, s]) => [
      id,
      {
        count: s.count,
        requesterIds: [...s.people],
        importantRequesterIds: [...s.important],
        customerKeys: [...s.customers],
        customerRevenue: s.revenue,
      },
    ]),
  );
}

const NONE: RequestSummary = { count: 0, requesterIds: [], importantRequesterIds: [] };

// The issues with their summaries; an issue without feedback gets an empty one. The
// input array is returned as it is while no summaries have loaded.
export function withRequests<T extends { id: string; requests?: RequestSummary }>(
  issues: T[],
  summaries: ReadonlyMap<string, RequestSummary> | undefined,
): T[] {
  if (!summaries) return issues;
  return issues.map((i) => ({ ...i, requests: summaries.get(i.id) ?? NONE }));
}

export function requesterCount(issue: Pick<Issue, 'requests'>): number {
  return issue.requests?.requesterIds.length ?? 0;
}

export function importantRequesterCount(issue: Pick<Issue, 'requests'>): number {
  return issue.requests?.importantRequesterIds.length ?? 0;
}

// The Requests badge's text for screen readers.
export function requestsBadgeLabel(people: number, important: number): string {
  const asked = `${people} ${people === 1 ? 'person' : 'people'} asked`;
  return important > 0 ? `${asked}, ${important} marked it important` : asked;
}

// A menu's options without the Requests one where the viewer reads no feedback
// (guests) or the list has no request counts (My issues).
export function requestOptions<T extends { value: string }>(
  options: T[],
  requestsOn: boolean,
): T[] {
  return requestsOn ? options : options.filter((o) => o.value !== 'requests');
}

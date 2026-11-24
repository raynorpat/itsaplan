import type { Issue, RequestSummary } from '@/types/issue';

// Requests (feedback) on issue lists: a summary per issue built from the team's
// feedback items, attached to the board's issues for the Requests display property,
// filter, ordering and Insights.

export interface NeedRef {
  issueId: string;
  priority: number;
  requesterId: string | null;
}

// One summary per issue that has feedback. Feedback without a requester counts as an
// item but not as a person, as on the server.
export function summarizeNeeds(needs: readonly NeedRef[]): Map<string, RequestSummary> {
  const out = new Map<string, { count: number; people: Set<string>; important: Set<string> }>();
  for (const n of needs) {
    let s = out.get(n.issueId);
    if (!s) {
      s = { count: 0, people: new Set(), important: new Set() };
      out.set(n.issueId, s);
    }
    s.count += 1;
    if (n.requesterId) {
      s.people.add(n.requesterId);
      if (n.priority === 1) s.important.add(n.requesterId);
    }
  }
  return new Map(
    [...out].map(([id, s]) => [
      id,
      { count: s.count, requesterIds: [...s.people], importantRequesterIds: [...s.important] },
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

// Feedback on issues (Linear's customer requests): a quote from a requester, a person
// outside the workspace, whose source attachment names them.

import type { WorkspaceRole } from '@/types/workspace';

export interface FeedbackRequester {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface FeedbackItem {
  id: string;
  body: string | null;
  important: boolean;
  createdAt: string;
  issue: { id: string; identifier: string; title: string };
  attachmentId: string | null;
  // Where it came from, as the source attachment's subtitle ("Logged by Pat").
  source: string | null;
  requester: FeedbackRequester | null;
}

export interface FeedbackGroup {
  issue: FeedbackItem['issue'];
  items: FeedbackItem[];
  people: number;
}

// The source type of the attachment that names a feedback item's requester; it is
// shown with the feedback, not in the issue's links.
export const isFeedbackAttachment = (sourceType: string | null | undefined): boolean =>
  sourceType === 'feedback';

export function feedbackHeader(people: number): string {
  if (people <= 0) return 'Feedback';
  return `Feedback · ${people} ${people === 1 ? 'person' : 'people'}`;
}

// What a guest sees on an issue: how many people asked, never who; null when nobody did.
export function guestFeedbackText(people: number): string | null {
  if (people <= 0) return null;
  return `${people} ${people === 1 ? 'person' : 'people'} asked for this`;
}

// The distinct people who gave the feedback; an item without a requester is no person.
export function countPeople(items: readonly FeedbackItem[]): number {
  return new Set(items.flatMap((i) => (i.requester ? [i.requester.id] : []))).size;
}

const newestFirst = (x: FeedbackItem, y: FeedbackItem) => y.createdAt.localeCompare(x.createdAt);

// A project's feedback grouped by issue: the newest feedback first in each group, and
// the group with the newest feedback first.
export function groupFeedbackByIssue(items: readonly FeedbackItem[]): FeedbackGroup[] {
  const byIssue = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const list = byIssue.get(item.issue.id);
    if (list) list.push(item);
    else byIssue.set(item.issue.id, [item]);
  }
  return [...byIssue.values()]
    .map((list) => {
      const sorted = [...list].sort(newestFirst);
      return { issue: sorted[0]!.issue, items: sorted, people: countPeople(sorted) };
    })
    .sort((x, y) => newestFirst(x.items[0]!, y.items[0]!));
}

// Owners, admins and members read and write feedback; the API gives guests (and app
// users, read as guests) none, so the web shows them nothing.
export const canSeeFeedback = (role: WorkspaceRole | null): boolean =>
  role !== null && role !== 'guest';

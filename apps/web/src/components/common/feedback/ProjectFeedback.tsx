'use client';

import Link from 'next/link';
import { MessageSquareQuote } from 'lucide-react';
import { useProjectFeedbackQuery } from '@/services/feedback.service';
import { countPeople, feedbackHeader, groupFeedbackByIssue } from '@/utils/feedback';
import { issuePathFromIdentifier } from '@/utils/issueNavigation';
import FeedbackItemRow from './FeedbackItemRow';

// The feedback on a project's issues, grouped by issue (newest first); feedback is
// added and changed on the issue. Shown to owners, admins and members only (see the
// caller); nothing shows when the project's issues have none.
export default function ProjectFeedback({ projectId }: { projectId: string }) {
  const items = useProjectFeedbackQuery(projectId, { enabled: true }).data ?? [];
  if (items.length === 0) return null;
  const groups = groupFeedbackByIssue(items);

  return (
    <section aria-label="Feedback">
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageSquareQuote className="size-3.5" aria-hidden />
        {feedbackHeader(countPeople(items))}
      </h3>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.issue.id}>
            <Link
              href={issuePathFromIdentifier(group.issue.identifier)}
              className="flex items-center gap-2 text-sm hover:underline"
            >
              <span className="shrink-0 text-xs text-muted-foreground">
                {group.issue.identifier}
              </span>
              <span className="truncate">{group.issue.title}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {group.people === 1 ? '1 person' : `${group.people} people`}
              </span>
            </Link>
            <ul className="-mx-2 mt-1">
              {group.items.map((item) => (
                <FeedbackItemRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

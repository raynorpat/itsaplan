'use client';

import Link from 'next/link';
import { Flame } from 'lucide-react';
import { StateIcon } from '@/components/common/issue/IssueIcons';
import { formatShortDate } from '@/utils/dates';
import { issuePathFromIdentifier } from '@/utils/issueNavigation';
import type { PersonIssueFeedback } from '../services/people.service';

// A person's feedback grouped by issue: the issue's status, identifier and title (an
// archived issue is marked), then each quote with its date and Important marker.
export default function PersonFeedback({ groups }: { groups: PersonIssueFeedback[] }) {
  if (groups.length === 0)
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">No feedback on issues you can see.</p>
    );
  return (
    <ul className="flex flex-col gap-4 px-4 pb-6">
      {groups.map((g) => (
        <li key={g.issue.id}>
          <Link
            href={issuePathFromIdentifier(g.issue.identifier)}
            className="flex items-center gap-2 rounded-md py-1 text-sm hover:underline"
          >
            <StateIcon stateType={g.issue.state.type} color={g.issue.state.color} />
            <span className="shrink-0 text-xs text-muted-foreground">{g.issue.identifier}</span>
            <span className="truncate font-medium">{g.issue.title}</span>
            <span className="sr-only">({g.issue.state.name})</span>
            {g.issue.archivedAt && (
              <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground uppercase">
                Archived
              </span>
            )}
          </Link>
          <ul className="mt-1 flex flex-col gap-1.5 pl-6">
            {g.feedback.map((f) => (
              <li key={f.id} className="text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {formatShortDate(f.createdAt)}
                  {f.important && (
                    <span className="inline-flex items-center gap-0.5 text-orange-600 dark:text-orange-400">
                      <Flame className="size-3" aria-hidden />
                      Important
                    </span>
                  )}
                </div>
                {f.body && (
                  <blockquote className="border-l-2 pl-2 whitespace-pre-wrap text-muted-foreground">
                    {f.body}
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

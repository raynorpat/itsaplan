'use client';

import Link from 'next/link';
import Avatar from '@/components/common/Avatar';
import { Button } from '@/components/ui/button';
import { feedbackPersonPath } from '@/utils/paths';
import type { Person } from '../services/people.service';
import { feedbackCountText, lastFeedbackText } from '../utils/people';

// The people who gave feedback, one row each: avatar, name and email, how much
// feedback they gave and when they last did.
export default function PeopleList({
  people,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  people: Person[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const now = new Date();
  return (
    <div>
      <ul className="divide-y border-y">
        {people.map((p) => (
          <li key={p.id}>
            <Link
              href={feedbackPersonPath(p.id)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
            >
              <Avatar name={p.name} image={p.avatarUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                {p.email && (
                  <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
                )}
              </span>
              <span className="w-32 shrink-0 text-right text-xs text-muted-foreground">
                {feedbackCountText(p.feedbackCount)}
              </span>
              <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                {lastFeedbackText(p.lastFeedbackAt, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="flex justify-center py-3">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

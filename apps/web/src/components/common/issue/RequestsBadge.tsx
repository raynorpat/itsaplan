import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { importantRequesterCount, requesterCount, requestsBadgeLabel } from '@/utils/requests';
import type { Issue } from '@/types/issue';

// The number of people asking for an issue (its feedback), with the icon in the
// warning colour when someone marked it important. Nothing when nobody asked.
export function RequestsBadge({ issue }: { issue: Pick<Issue, 'requests'> }) {
  const people = requesterCount(issue);
  if (people === 0) return null;
  const important = importantRequesterCount(issue);
  const label = requestsBadgeLabel(people, important);
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
      title={label}
      aria-label={label}
    >
      <MessageSquare
        aria-hidden
        className={cn('size-3', important > 0 && 'text-amber-600 dark:text-amber-400')}
      />
      {people}
    </span>
  );
}

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import type { PortalIssue } from '../utils/portal';
import PortalStatusBadge from './PortalStatusBadge';
import PortalVoteButton from './PortalVoteButton';

export default function PortalIssueRow({
  slug,
  issue,
  signedIn,
}: {
  slug: string;
  issue: PortalIssue;
  signedIn: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
      <PortalVoteButton slug={slug} issue={issue} signedIn={signedIn} />
      <Link
        href={`/portal/${slug}/${issue.identifier}`}
        className="min-w-0 flex-1 truncate text-sm font-medium"
      >
        {issue.title}
      </Link>
      {issue.comments > 0 && (
        <span
          className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"
          aria-label={`${issue.comments} comments`}
        >
          <MessageSquare className="size-3.5" aria-hidden />
          {issue.comments}
        </span>
      )}
      <PortalStatusBadge status={issue.status} underReview={issue.underReview} />
    </li>
  );
}

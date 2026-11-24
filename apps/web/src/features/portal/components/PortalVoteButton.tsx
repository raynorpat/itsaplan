'use client';

import Link from 'next/link';
import { ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useVote } from '../services/portal.service';
import { voteLabel, type PortalIssue } from '../utils/portal';

// The vote count with its toggle. Signed out, it links to the board's sign-in page.
export default function PortalVoteButton({
  slug,
  issue,
  signedIn,
}: {
  slug: string;
  issue: PortalIssue;
  signedIn: boolean;
}) {
  const vote = useVote(slug, issue.identifier);
  const className = cn(
    'flex w-12 shrink-0 flex-col items-center rounded-md px-2 py-1 text-xs tabular-nums transition-colors',
    issue.voted ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent',
  );
  const content = (
    <>
      <ChevronUp className="size-4" aria-hidden />
      <span className="font-medium">{issue.votes}</span>
    </>
  );
  if (!signedIn)
    return (
      <Link
        href={`/portal/${slug}/sign-in`}
        className={className}
        aria-label={`${voteLabel(issue.votes)}. Sign in to vote`}
      >
        {content}
      </Link>
    );
  return (
    <button
      type="button"
      className={className}
      aria-pressed={issue.voted}
      aria-label={`${voteLabel(issue.votes)}. ${issue.voted ? 'Remove your vote' : 'Vote'}`}
      disabled={vote.isPending}
      onClick={() => vote.mutate(!issue.voted)}
    >
      {content}
    </button>
  );
}

'use client';

import { useSession } from '@/lib/auth-client';
import { useIssueReactionsQuery, useToggleReaction } from '../../services/reactions.service';
import ReactionBar from './ReactionBar';

// The issue's own reactions, shown under its description.

export default function IssueReactions({ issueId }: { issueId: string }) {
  const { data: session } = useSession();
  const viewerId = session?.user.id ?? null;
  const reactions = useIssueReactionsQuery(issueId);
  const toggle = useToggleReaction();

  return (
    <ReactionBar
      className="mt-3"
      reactions={reactions.data ?? []}
      viewerId={viewerId}
      onToggle={(emoji, mineId) => toggle.mutate({ target: { issueId }, emoji, mineId })}
    />
  );
}

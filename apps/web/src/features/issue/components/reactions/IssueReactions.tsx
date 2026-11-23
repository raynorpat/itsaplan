'use client';

import { useSession } from '@/lib/auth-client';
import { useToggleReaction } from '@/services/reactions.service';
import { useIssueReactionsQuery } from '../../services/issueReactions.service';
import ReactionBar from '@/components/common/reactions/ReactionBar';

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
      pending={toggle.isPending}
      onToggle={(emoji, mineId) => toggle.mutate({ target: { issueId }, emoji, mineId })}
    />
  );
}

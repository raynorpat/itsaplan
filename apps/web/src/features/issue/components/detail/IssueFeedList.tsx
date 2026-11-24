import { Button } from '@/components/ui/button';
import { useFeedQuery } from '../../services/issueFeed.service';
import { type CommentContext } from '@/utils/commentContext';
import ActivityLine from './ActivityLine';
import CommentThread from '@/components/common/comments/CommentThread';
import AgentSessionThread from '../agent/AgentSessionThread';
import { threadSessionIds } from '../../utils/agentSession';

// The issue's feed as Linear shows it, oldest at the top and newest just above the
// comment box: comment threads and change entries, a page at a time with "Show
// older" above them for the rest. The feed query refetches when an issue edit
// or a new comment invalidates it (see useUpdateIssueDetail / useCreateComment), so
// it reflects edits without the parent signaling it.

export default function IssueFeedList({
  issueId,
  imageByUserId,
  ctx,
}: {
  issueId: string;
  imageByUserId: Map<string, string | null>;
  ctx: CommentContext;
}) {
  const feedQuery = useFeedQuery(issueId);
  // The query pages newest first; the list reads top to bottom in time order.
  const entries = [...(feedQuery.data ?? [])].reverse();

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {feedQuery.isLoading ? 'Loading…' : 'No activity yet.'}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {feedQuery.hasOlder && (
        <li>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={feedQuery.loadingOlder}
            onClick={feedQuery.loadOlder}
          >
            {feedQuery.loadingOlder ? 'Loading…' : 'Show older'}
          </Button>
        </li>
      )}
      {entries.map((entry) => {
        const sessionIds = entry.item.kind === 'comment' ? threadSessionIds(entry) : [];
        return sessionIds.length > 0 ? (
          <AgentSessionThread
            key={entry.item.id}
            entry={entry}
            sessionIds={sessionIds}
            imageByUserId={imageByUserId}
            ctx={ctx}
          />
        ) : entry.item.kind === 'comment' ? (
          <CommentThread
            key={entry.item.id}
            entry={entry}
            imageByUserId={imageByUserId}
            ctx={ctx}
          />
        ) : (
          <ActivityLine key={entry.item.id} item={entry.item} />
        );
      })}
    </ul>
  );
}

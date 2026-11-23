import { Button } from '@/components/ui/button';
import { useFeedQuery } from '../../services/issueFeed.service';
import { type CommentContext } from '@/utils/commentContext';
import ActivityLine from './ActivityLine';
import CommentThread from '@/components/common/comments/CommentThread';
import AgentSessionThread from '../agent/AgentSessionThread';

// The issue's feed, newest first: comment threads and change entries, a page at a
// time with "Show older" for the rest. The feed query refetches when an issue edit
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
  const entries = feedQuery.data ?? [];

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {feedQuery.isLoading ? 'Loading…' : 'No activity yet.'}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.map((entry) =>
        entry.item.kind === 'comment' && entry.item.agentSessionId ? (
          <AgentSessionThread
            key={entry.item.id}
            entry={entry}
            sessionId={entry.item.agentSessionId}
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
        ),
      )}
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
    </ul>
  );
}

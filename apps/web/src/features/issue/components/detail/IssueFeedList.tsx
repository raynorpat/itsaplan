import { useFeedQuery } from '../../services/comments.service';
import ActivityLine from './ActivityLine';
import CommentThread from './CommentThread';

// The issue's feed, newest first: comment threads and change entries. The feed
// query refetches when an issue edit or a new comment invalidates it (see
// useUpdateIssueDetail / useCreateComment), so it reflects edits without the
// parent signaling it.

export default function IssueFeedList({
  issueId,
  imageByUserId,
}: {
  issueId: string;
  imageByUserId: Map<string, string | null>;
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
        entry.item.kind === 'comment' ? (
          <CommentThread key={entry.item.id} entry={entry} imageByUserId={imageByUserId} />
        ) : (
          <ActivityLine key={entry.item.id} item={entry.item} />
        ),
      )}
    </ul>
  );
}

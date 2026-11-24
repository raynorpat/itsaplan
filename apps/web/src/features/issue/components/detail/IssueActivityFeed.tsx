import type { Assignee } from '@/types/team';
import { useCommentContext } from '@/hooks/useCommentContext';
import CommentComposer from '@/components/common/comments/CommentComposer';
import IssueFeedList from './IssueFeedList';
import IssueSubscribers from '../subscribers/IssueSubscribers';

// The issue's activity as in Linear: a header with Subscribe and the subscribers, the
// feed of comments and change entries in time order, and the comment box under it.

export default function IssueActivityFeed({
  issueId,
  assignees,
  imageByUserId,
}: {
  issueId: string;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
}) {
  const ctx = useCommentContext({ issueId }, assignees);

  return (
    <div className="mt-6 border-t pt-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Activity</h3>
        <IssueSubscribers issueId={issueId} />
      </div>

      <IssueFeedList issueId={issueId} imageByUserId={imageByUserId} ctx={ctx} />

      <div className="mt-4">
        <CommentComposer
          target={{ issueId }}
          assignees={assignees}
          authorName={ctx.authorName}
          authorImage={ctx.authorImage}
        />
      </div>
    </div>
  );
}

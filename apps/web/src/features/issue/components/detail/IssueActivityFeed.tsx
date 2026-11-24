import type { Assignee } from '@/types/team';
import { useCommentContext } from '@/hooks/useCommentContext';
import CommentComposer from '@/components/common/comments/CommentComposer';
import IssueFeedList from './IssueFeedList';
import IssueSubscribers from '../subscribers/IssueSubscribers';
import { useIssuePortalBoards, usePostOnPortal } from '../../services/issuePortal.service';

// The issue's activity as in Linear: a header with Subscribe and the subscribers, the
// feed of comments and change entries in time order, and the comment box under it.
// Members (`showPortal`) may start a thread on a board that shows portal threads.

export default function IssueActivityFeed({
  issueId,
  assignees,
  imageByUserId,
  showPortal,
}: {
  issueId: string;
  assignees: Assignee[];
  imageByUserId: Map<string, string | null>;
  showPortal: boolean;
}) {
  const ctx = useCommentContext({ issueId }, assignees);
  const boards = (useIssuePortalBoards(issueId, showPortal).data ?? []).filter(
    (b) => b.comments === 'portal',
  );
  const postOnPortal = usePostOnPortal(issueId);

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
          portal={{
            boards,
            post: (boardId, body) => postOnPortal.mutateAsync({ boardId, body }),
          }}
        />
      </div>
    </div>
  );
}

import { type Assignee } from '@/lib/api';
import { useCommentContext } from '@/hooks/useCommentContext';
import CommentComposer from '@/components/common/comments/CommentComposer';
import IssueFeedList from './IssueFeedList';

// The issue's activity log: a comment composer over the flat feed of comments and
// change entries, newest first. The status timeline sits above it as its own block.

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
      <h3 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Activity
      </h3>

      <CommentComposer
        target={{ issueId }}
        assignees={assignees}
        authorName={ctx.authorName}
        authorImage={ctx.authorImage}
      />

      <IssueFeedList issueId={issueId} imageByUserId={imageByUserId} ctx={ctx} />
    </div>
  );
}

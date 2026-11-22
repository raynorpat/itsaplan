import { type Assignee } from '@/lib/api';
import { useSession } from '@/lib/auth-client';
import { usePermissions } from '@/hooks/usePermissions';
import CommentComposer from './CommentComposer';
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
  const { data: session } = useSession();
  const { canManage } = usePermissions();

  const user = session?.user ?? null;
  const authorName = user?.name || user?.email || 'You';
  const authorImage = (user as { image?: string | null } | null)?.image ?? null;
  const ctx = {
    issueId,
    viewerId: user?.id ?? null,
    canManage,
    assignees,
    authorName,
    authorImage,
  };

  return (
    <div className="mt-6 border-t pt-5">
      <h3 className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Activity
      </h3>

      <CommentComposer
        issueId={issueId}
        assignees={assignees}
        authorName={authorName}
        authorImage={authorImage}
      />

      <IssueFeedList issueId={issueId} imageByUserId={imageByUserId} ctx={ctx} />
    </div>
  );
}

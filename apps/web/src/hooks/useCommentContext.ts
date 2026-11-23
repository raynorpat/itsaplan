import type { Assignee } from '@/types/team';
import { useSession } from '@/lib/auth-client';
import { usePermissions } from './usePermissions';
import { type CommentTarget } from '@/utils/commentTarget';
import { type CommentContext } from '@/utils/commentContext';

// The CommentContext for a live comment list (an issue's feed, a document's, a
// project's or a project update's comments): the target, the signed-in viewer, whether they manage the team, the
// team's people for mentions, and the viewer's name and picture for the composer.
export function useCommentContext(target: CommentTarget, assignees: Assignee[]): CommentContext {
  const { data: session } = useSession();
  const { canManage } = usePermissions();
  const user = session?.user ?? null;
  return {
    target,
    viewerId: user?.id ?? null,
    canManage,
    assignees,
    authorName: user?.name || user?.email || 'You',
    authorImage: (user as { image?: string | null } | null)?.image ?? null,
  };
}

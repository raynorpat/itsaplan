import { type Assignee } from '@/lib/api';
import { type CommentTarget } from '@/utils/commentTarget';

// What every comment in a live comment list needs to show the viewer's controls
// and its reply / edit box: the issue or document it belongs to, the viewer (null when signed out), whether
// they manage the team (to delete others' comments), the team's people for
// mentions, and the viewer's name and picture for the composer.
export interface CommentContext {
  target: CommentTarget;
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
  authorName: string;
  authorImage: string | null;
}

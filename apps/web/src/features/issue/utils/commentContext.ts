import { type Assignee } from '@/lib/api';

// What every comment in the issue's live feed needs to show the viewer's controls
// and its reply / edit box: the issue, the viewer (null when signed out), whether
// they manage the team (to delete others' comments), the team's people for
// mentions, and the viewer's name and picture for the composer.
export interface CommentContext {
  issueId: string;
  viewerId: string | null;
  canManage: boolean;
  assignees: Assignee[];
  authorName: string;
  authorImage: string | null;
}

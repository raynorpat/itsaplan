import { qk } from '@/services/queryKeys';

// What a comment thread belongs to: an issue, a document (Linear's documentContentId
// is the document's id here), a project, or a project update. An update carries its
// project, whose update list holds the update's comments.
export type CommentTarget =
  | { issueId: string }
  | { documentId: string }
  | { projectId: string }
  | { projectUpdateId: string; projectId: string };

// The commentCreate input field that attaches a new comment to the target.
export function commentTargetInput(
  target: CommentTarget,
):
  | { issueId: string }
  | { documentContentId: string }
  | { projectId: string }
  | { projectUpdateId: string } {
  if ('issueId' in target) return { issueId: target.issueId };
  if ('documentId' in target) return { documentContentId: target.documentId };
  if ('projectUpdateId' in target) return { projectUpdateId: target.projectUpdateId };
  return { projectId: target.projectId };
}

// The cache entry that holds the target's comments: the issue's feed, the document's
// comment list, the project's activity, or the project's updates.
export function commentTargetKey(target: CommentTarget): readonly unknown[] {
  if ('issueId' in target) return qk.feed(target.issueId);
  if ('documentId' in target) return qk.documentComments(target.documentId);
  if ('projectUpdateId' in target) return qk.projectUpdates(target.projectId);
  return qk.projectActivity(target.projectId);
}

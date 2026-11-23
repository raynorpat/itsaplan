import { qk } from '@/services/queryKeys';

// What a comment thread belongs to: an issue, or a document (Linear's
// documentContentId is the document's id here).
export type CommentTarget = { issueId: string } | { documentId: string };

// The commentCreate input field that attaches a new comment to the target.
export function commentTargetInput(
  target: CommentTarget,
): { issueId: string } | { documentContentId: string } {
  return 'issueId' in target
    ? { issueId: target.issueId }
    : { documentContentId: target.documentId };
}

// The cache entry that holds the target's comments: the issue's feed, or the
// document's comment list.
export function commentTargetKey(target: CommentTarget): readonly unknown[] {
  return 'issueId' in target ? qk.feed(target.issueId) : qk.documentComments(target.documentId);
}

import type { CommentRow } from '../../comments/store';

// Linear's Comment over a comment row. `parentUrl` is the web URL of the comment's
// issue, project or project update.
export function toComment(row: CommentRow, parentUrl: string) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: null,
    editedAt: row.editedAt,
    resolvedAt: row.resolvedAt,
    issueId: row.issueId,
    projectId: row.projectId,
    projectUpdateId: row.projectUpdateId,
    parentId: row.parentId,
    userId: row.userId,
    resolvingUserId: row.resolvingUserId,
    resolvingCommentId: row.resolvingCommentId,
    url: `${parentUrl}#comment-${row.id}`,
  };
}

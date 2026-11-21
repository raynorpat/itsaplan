import type { issueActivity } from '@repo/db';

// Linear's Comment over an issue_activity row of kind 'comment'. Comments cannot
// be edited, so updatedAt is the creation time and editedAt is null. `issueUrl`
// is the web URL of the comment's issue.
export function toComment(row: typeof issueActivity.$inferSelect, issueUrl: string) {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    body: row.body ?? '',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    editedAt: null,
    issueId: row.issueId,
    userId: row.actorUserId,
    url: `${issueUrl}#comment-${row.id}`,
  };
}

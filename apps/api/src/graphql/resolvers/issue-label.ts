import type { label } from '@repo/db';

// Linear's IssueLabel over a label row. A group is a label with isGroup; a grouped
// label's parentId is its group; a workspace label has no team.
export function toIssueLabel(row: typeof label.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    isGroup: row.isGroup,
    parentId: row.parentId,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    // Read by the relation resolvers; not schema fields.
    creatorUserId: row.creatorUserId,
  };
}

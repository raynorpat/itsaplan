import type { label, labelGroup } from '@repo/db';

// Linear's IssueLabel. A team label group is itself an IssueLabel with isGroup:
// true, and a grouped label's parentId is its group.
export function toIssueLabel(row: typeof label.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: null,
    isGroup: false,
    parentId: row.groupId,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
  };
}

export function toLabelGroupAsIssueLabel(row: typeof labelGroup.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: null,
    isGroup: true,
    parentId: null,
    teamId: row.teamId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: null,
  };
}

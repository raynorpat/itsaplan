import type { label, labelGroup } from '@repo/db';

// Linear's IssueLabel. A team label group is itself an IssueLabel with isGroup:
// true, and a grouped label's parentId is its group. Labels have no update time,
// so updatedAt is the creation time.
export function toIssueLabel(row: typeof label.$inferSelect) {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: null,
    isGroup: false,
    parentId: row.groupId,
    teamId: row.teamId,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

export function toLabelGroupAsIssueLabel(row: typeof labelGroup.$inferSelect) {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: null,
    isGroup: true,
    parentId: null,
    teamId: row.teamId,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

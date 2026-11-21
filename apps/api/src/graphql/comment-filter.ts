import { comment } from '@repo/db';
import { isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, type FieldHandlers } from './filter';

// CommentFilter as SQL over the comment table. Supported: id, body, createdAt,
// updatedAt, and the references issue, project, projectUpdate, parent and user by
// `id` (plus `null` for the nullable ones), with and / or. Anything else is
// INVALID_INPUT.

// A reference filter ({ id, null }) on a column holding the referenced row's id.
function ref(column: AnyColumn, value: unknown, path: string): SQL {
  return (
    filterSql(
      value,
      {
        id: (v, p) => compareId(column, v, p),
        null: (v) => (v ? isNull(column) : sql`${column} IS NOT NULL`),
      },
      path,
    ) ?? sql`true`
  );
}

const handlers: FieldHandlers = {
  id: (v, p) => compareId(comment.id, v, p),
  body: (v, p) => compare(comment.body, v, p),
  createdAt: (v, p) => compare(comment.createdAt, v, p),
  updatedAt: (v, p) => compare(comment.updatedAt, v, p),
  issue: (v, p) => ref(comment.issueId, v, p),
  project: (v, p) => ref(comment.projectId, v, p),
  projectUpdate: (v, p) => ref(comment.projectUpdateId, v, p),
  parent: (v, p) => ref(comment.parentId, v, p),
  user: (v, p) => ref(comment.userId, v, p),
};

export const commentFilterSql = (filter: unknown): SQL | undefined => filterSql(filter, handlers);

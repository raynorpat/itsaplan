import { comment } from '@repo/db';
import type { SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// CommentFilter as SQL over the comment table. Supported: id, body, createdAt,
// updatedAt, and the references issue, project, projectUpdate, parent and user by
// `id` (plus `null` for the nullable ones), with and / or. Anything else is
// INVALID_INPUT.

const handlers: FieldHandlers = {
  id: (v, p) => compareId(comment.id, v, p),
  body: (v, p) => compare(comment.body, v, p),
  createdAt: (v, p) => compare(comment.createdAt, v, p),
  updatedAt: (v, p) => compare(comment.updatedAt, v, p),
  issue: (v, p) => refFilter(comment.issueId, v, p),
  project: (v, p) => refFilter(comment.projectId, v, p),
  projectUpdate: (v, p) => refFilter(comment.projectUpdateId, v, p),
  parent: (v, p) => refFilter(comment.parentId, v, p),
  user: (v, p) => refFilter(comment.userId, v, p),
};

export const commentFilterSql = (filter: unknown): SQL | undefined => filterSql(filter, handlers);

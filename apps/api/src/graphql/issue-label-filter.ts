import { label } from '@repo/db';
import type { SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// IssueLabelFilter as SQL over the label table. Supported: id, name, isGroup,
// createdAt, updatedAt, team and parent by `id` (plus `null`: a workspace label has
// no team, an ungrouped label no parent), with and / or. Anything else is
// INVALID_INPUT.

const handlers: FieldHandlers = {
  id: (v, p) => compareId(label.id, v, p),
  name: (v, p) => compare(label.name, v, p),
  isGroup: (v, p) => compare(label.isGroup, v, p),
  createdAt: (v, p) => compare(label.createdAt, v, p),
  updatedAt: (v, p) => compare(label.updatedAt, v, p),
  team: (v, p) => refFilter(label.teamId, v, p),
  parent: (v, p) => refFilter(label.parentId, v, p),
};

export const issueLabelFilterSql = (filter: unknown): SQL | undefined =>
  filterSql(filter, handlers);

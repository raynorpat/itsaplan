import { template } from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from './filter';

// TemplateFilter / NullableTemplateFilter as SQL over the template table: id, name,
// type, createdAt, updatedAt and team by `id` (`null: true` for workspace templates),
// with and / or. Anything else (inheritedFromId: templates are not inherited here) is
// INVALID_INPUT.
const handlers: FieldHandlers = {
  id: (v, p) => compareId(template.id, v, p),
  name: (v, p) => compare(template.name, v, p),
  type: (v, p) => compare(template.type, v, p),
  createdAt: (v, p) => compare(template.createdAt, v, p),
  updatedAt: (v, p) => compare(template.updatedAt, v, p),
  team: (v, p) => refFilter(template.teamId, v, p),
  // Every template exists, so `null: true` matches none.
  null: (v) => (v ? sql`false` : sql`true`),
};

export const templateFilterSql = (filter: unknown, path = 'filter'): SQL | undefined =>
  filterSql(filter, handlers, path);

import { and, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { gqlError } from './errors';
import { UUID_RE } from '../shared/lib';

// Translates Linear filter inputs (WorkflowStateFilter, IssueFilter, …) to SQL.
// Each entity lists the filter fields it supports; `and` / `or` nest. A field or
// comparator that is not supported is an INVALID_INPUT error naming it, never a
// silently ignored condition.

type Column = AnyColumn | SQL;
type Comparator = Record<string, unknown>;
export type FieldHandlers = Record<string, (value: unknown, path: string) => SQL>;

function unsupported(path: string): never {
  throw gqlError('INVALID_INPUT', `Filter ${path} is not supported`);
}

// Escapes LIKE metacharacters so a value is matched literally.
const like = (v: unknown) => String(v).replace(/[\\%_]/g, (c) => `\\${c}`);

// String, number and date comparators.
export function compare(col: Column, comp: unknown, path: string): SQL {
  const parts: SQL[] = [];
  for (const [op, v] of Object.entries(comp as Comparator)) {
    if (v === undefined) continue;
    // A null list is no constraint (GraphQL allows `in: null`).
    if ((op === 'in' || op === 'nin') && v === null) continue;
    switch (op) {
      case 'eq':
        parts.push(v === null ? sql`${col} IS NULL` : sql`${col} = ${v}`);
        break;
      case 'neq':
        parts.push(v === null ? sql`${col} IS NOT NULL` : sql`${col} IS DISTINCT FROM ${v}`);
        break;
      case 'in':
        parts.push((v as unknown[]).length ? sql`${col} IN ${v}` : sql`false`);
        break;
      case 'nin':
        parts.push((v as unknown[]).length ? sql`${col} NOT IN ${v}` : sql`true`);
        break;
      case 'null':
        parts.push(v ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`);
        break;
      case 'lt':
        parts.push(sql`${col} < ${v}`);
        break;
      case 'lte':
        parts.push(sql`${col} <= ${v}`);
        break;
      case 'gt':
        parts.push(sql`${col} > ${v}`);
        break;
      case 'gte':
        parts.push(sql`${col} >= ${v}`);
        break;
      case 'eqIgnoreCase':
        parts.push(sql`lower(${col}) = lower(${v})`);
        break;
      case 'contains':
        parts.push(sql`${col} LIKE ${`%${like(v)}%`}`);
        break;
      case 'containsIgnoreCase':
        parts.push(sql`${col} ILIKE ${`%${like(v)}%`}`);
        break;
      case 'notContains':
        parts.push(sql`${col} NOT LIKE ${`%${like(v)}%`}`);
        break;
      case 'startsWith':
        parts.push(sql`${col} LIKE ${`${like(v)}%`}`);
        break;
      default:
        unsupported(`${path}.${op}`);
    }
  }
  return and(...parts) ?? sql`true`;
}

// ID comparators on a uuid column. A value that is not a UUID matches no row
// instead of failing the uuid cast.
export function compareId(col: Column, comp: unknown, path: string): SQL {
  const ids = (v: unknown) => (v as string[]).filter((id) => UUID_RE.test(id));
  const parts: SQL[] = [];
  for (const [op, v] of Object.entries(comp as Comparator)) {
    if (v === undefined) continue;
    if ((op === 'in' || op === 'nin') && v === null) continue;
    switch (op) {
      case 'eq':
        parts.push(UUID_RE.test(String(v)) ? sql`${col} = ${v}::uuid` : sql`false`);
        break;
      case 'neq':
        parts.push(UUID_RE.test(String(v)) ? sql`${col} IS DISTINCT FROM ${v}::uuid` : sql`true`);
        break;
      case 'in':
        parts.push(compare(col, { in: ids(v) }, path));
        break;
      case 'nin':
        parts.push(compare(col, { nin: ids(v) }, path));
        break;
      case 'null':
        parts.push(compare(col, { null: v }, path));
        break;
      default:
        unsupported(`${path}.${op}`);
    }
  }
  return and(...parts) ?? sql`true`;
}

// A filter object: each supported field through its handler, `and` / `or` lists
// recursively. Returns undefined for an empty or absent filter.
export function filterSql(
  filter: unknown,
  handlers: FieldHandlers,
  path = 'filter',
): SQL | undefined {
  if (filter == null) return undefined;
  const parts: SQL[] = [];
  for (const [key, value] of Object.entries(filter as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    const at = `${path}.${key}`;
    if (key === 'and' || key === 'or') {
      const subs = (value as unknown[])
        .map((f, i) => filterSql(f, handlers, `${at}[${i}]`))
        .filter((s): s is SQL => s != null);
      if (subs.length) parts.push((key === 'and' ? and(...subs) : or(...subs))!);
      continue;
    }
    const handler = handlers[key];
    if (!handler) unsupported(at);
    parts.push(handler(value, at));
  }
  return parts.length ? and(...parts) : undefined;
}

// A reference filter ({ id, null }) on a column holding the referenced row's id:
// `id` compares the id, `null: true` matches an unset reference.
export function refFilter(column: AnyColumn, value: unknown, path: string): SQL {
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

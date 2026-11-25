import { db } from '@repo/db';
import { and, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { gqlError } from './errors';
import { pageSize, type Connection, type PageArgs } from './connection';
import { UUID_RE } from '../shared/lib';

// Linear's `sort` arguments: a list of one-key objects (`[{ priority: { order:
// Ascending } }, { dueDate: { order: Descending, nulls: first } }]`) applied in order.
// Each key becomes one or more SQL expressions with a direction and a null placement;
// the list's tie-break chain follows, so every row has one place. Sorted lists page
// forward only. The cursor is base64url JSON of the row's sort values and id, so a
// keyset condition resumes exactly after it whatever the keys' types.

export type SortType = 'number' | 'text' | 'timestamp' | 'date' | 'uuid' | 'boolean';

export interface SortKey {
  sql: SQL;
  order: 'asc' | 'desc';
  nulls: 'first' | 'last';
  type: SortType;
}

// What a sort key's builder returns: the expressions in order. `order` / `nulls` set
// on a part override the ones the caller asked for (a key ordering part of its rows
// by its own rule, e.g. closed issues by recency).
export type SortPart = Omit<SortKey, 'order' | 'nulls'> & Partial<Pick<SortKey, 'order' | 'nulls'>>;

export type SortBuilder = (options: Record<string, unknown>, order: 'asc' | 'desc') => SortPart[];

function direction(value: unknown, path: string): 'asc' | 'desc' {
  if (value == null || value === 'Ascending') return 'asc';
  if (value === 'Descending') return 'desc';
  throw gqlError('INVALID_INPUT', `${path}.order must be Ascending or Descending`);
}

function nullPlacement(value: unknown, path: string): 'first' | 'last' {
  if (value == null || value === 'last') return 'last';
  if (value === 'first') return 'first';
  throw gqlError('INVALID_INPUT', `${path}.nulls must be first or last`);
}

// The sort keys a `sort` argument asks for, or null when it asks for none.
export function parseSortInput(
  input: unknown,
  builders: Record<string, SortBuilder>,
  path = 'sort',
): SortKey[] | null {
  if (input == null) return null;
  if (!Array.isArray(input)) throw gqlError('INVALID_INPUT', `${path} must be a list`);
  const keys: SortKey[] = [];
  input.forEach((entry, i) => {
    const at = `${path}[${i}]`;
    const fields = Object.entries((entry ?? {}) as Record<string, unknown>).filter(
      ([, v]) => v != null,
    );
    if (fields.length !== 1)
      throw gqlError('INVALID_INPUT', `${at} must name exactly one sort key`);
    const [name, raw] = fields[0]!;
    const build = builders[name];
    if (!build) throw gqlError('INVALID_INPUT', `Sort by ${name} is not supported`);
    const options = { ...(raw as Record<string, unknown>) };
    const order = direction(options.order, `${at}.${name}`);
    const nulls = nullPlacement(options.nulls, `${at}.${name}`);
    for (const part of build(options, order))
      keys.push({ ...part, order: part.order ?? order, nulls: part.nulls ?? nulls });
  });
  return keys.length > 0 ? keys : null;
}

// parseSortInput with text keys compared without regard to case, as Linear's lists
// order names and titles, by code point (`COLLATE "C"`), so the order does not depend
// on the database's collation and the web app (utils/team.ts compareText) orders text
// the same way.
export function parseCaselessSort(
  input: unknown,
  builders: Record<string, SortBuilder>,
  path = 'sort',
): SortKey[] | null {
  const keys = parseSortInput(input, builders, path);
  return (
    keys &&
    keys.map((k) => (k.type === 'text' ? { ...k, sql: sql`lower(${k.sql}) COLLATE "C"` } : k))
  );
}

const CAST: Record<SortType, SQL> = {
  number: sql`numeric`,
  text: sql`text`,
  timestamp: sql`timestamptz`,
  date: sql`date`,
  uuid: sql`uuid`,
  boolean: sql`boolean`,
};

const valueOf = (key: SortKey, value: unknown): SQL => sql`(${value})::${CAST[key.type]}`;

function orderSql(key: SortKey): SQL {
  return sql`${key.sql} ${key.order === 'asc' ? sql`ASC` : sql`DESC`} ${
    key.nulls === 'first' ? sql`NULLS FIRST` : sql`NULLS LAST`
  }`;
}

// Rows that come after the cursor value of one key, given its direction and null place.
function beyond(key: SortKey, value: unknown): SQL {
  if (value === null) return key.nulls === 'first' ? sql`${key.sql} IS NOT NULL` : sql`false`;
  const past =
    key.order === 'asc'
      ? sql`${key.sql} > ${valueOf(key, value)}`
      : sql`${key.sql} < ${valueOf(key, value)}`;
  return key.nulls === 'last' ? sql`(${past} OR ${key.sql} IS NULL)` : past;
}

const same = (key: SortKey, value: unknown): SQL =>
  value === null ? sql`${key.sql} IS NULL` : sql`${key.sql} = ${valueOf(key, value)}`;

// Rows after the cursor in the order of `keys` (lexicographic keyset).
function afterCursor(keys: SortKey[], values: unknown[]): SQL {
  const branches = keys.map((key, i) =>
    and(...keys.slice(0, i).map((k, j) => same(k, values[j])), beyond(key, values[i]))!,
  );
  return or(...branches)!;
}

function encodeCursor(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Whether a cursor value can stand for a key of this type (null stands for empty).
function fits(type: SortType, value: unknown): boolean {
  if (value === null) return true;
  switch (type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'text':
      return typeof value === 'string';
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'uuid':
      return typeof value === 'string' && UUID_RE.test(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

// The cursor's values, refused unless each fits its key, so a tampered cursor or one
// from another sort never reaches the database.
function decodeCursor(cursor: string, keys: SortKey[]): unknown[] {
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(values) &&
      values.length === keys.length &&
      values[values.length - 1] !== null &&
      keys.every((key, i) => fits(key.type, values[i]))
    )
      return values;
  } catch {
    // An unreadable cursor is refused below.
  }
  throw gqlError('INVALID_INPUT', 'Invalid cursor');
}

// One forward page of rows in the order of `keys`, then `tieBreak`, then `id`
// descending. `base(where, values)` is the list's query without ordering or limit,
// selecting `values` (the sort expressions, aliased `s0`, `s1`, …); this runs it as an
// inner query behind `OFFSET 0`, which keeps Postgres from inlining it, so each sort
// value is worked out once per row and the order and the cursor condition read the
// aliases. `rows(ids)` then loads the page's rows (in any order). The cursor carries
// the sort values and the id as a JSON array.
export async function paginateSorted<Row extends { id: string }, T>(
  args: PageArgs,
  keys: SortKey[],
  tieBreak: SortKey[],
  id: SQL,
  where: SQL | undefined,
  base: (where: SQL | undefined, values: Record<string, SQL.Aliased>) => SQLWrapper,
  rows: (ids: string[]) => Promise<Row[]>,
  map: (row: Row) => T,
): Promise<Connection<T>> {
  if (args.last != null || args.before != null)
    throw gqlError('INVALID_INPUT', 'A sorted list pages forward only (first / after)');
  const limit = pageSize(args.first, 'first');
  const all: SortKey[] = [
    ...keys,
    ...tieBreak,
    { sql: id, order: 'desc', nulls: 'last', type: 'uuid' },
  ];
  const aliases = all.map((_, i) => `s${i}`);
  const values = Object.fromEntries(
    all.map((k, i) => [aliases[i]!, sql`${k.sql}`.as(aliases[i]!)]),
  );
  const outer = all.map((k, i) => ({
    ...k,
    sql: sql`${sql.identifier('sorted')}.${sql.identifier(aliases[i]!)}`,
  }));
  const after = args.after ? afterCursor(outer, decodeCursor(args.after, all)) : undefined;
  const found = await db.execute<{ sort_values: unknown[] }>(sql`
    SELECT json_build_array(${sql.join(
      outer.map((k) => k.sql),
      sql`, `,
    )}) AS sort_values
    FROM (${base(where, values)} OFFSET 0) ${sql.identifier('sorted')}
    ${after ? sql`WHERE ${after}` : sql``}
    ORDER BY ${sql.join(outer.map(orderSql), sql`, `)}
    LIMIT ${limit + 1}
  `);
  const page = [...found].slice(0, limit).map((r) => r.sort_values);
  const ids = page.map((v) => v[v.length - 1] as string);
  const byId = new Map((ids.length > 0 ? await rows(ids) : []).map((r) => [r.id, r]));
  const edges = page.flatMap((v, i) => {
    const row = byId.get(ids[i]!);
    return row ? [{ node: map(row), cursor: encodeCursor(v) }] : [];
  });
  return {
    nodes: edges.map((e) => e.node),
    edges,
    pageInfo: {
      hasNextPage: found.length > limit,
      hasPreviousPage: args.after != null,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

// The tie-break most lists share: newest first by creation time.
export const newestFirst = (createdAt: SQL): SortKey[] => [
  { sql: createdAt, order: 'desc', nulls: 'last', type: 'timestamp' },
];

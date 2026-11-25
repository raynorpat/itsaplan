import { and, or, sql, type SQL } from 'drizzle-orm';
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

function decodeCursor(cursor: string, length: number): unknown[] {
  try {
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    const id = Array.isArray(values) ? values[values.length - 1] : undefined;
    if (
      Array.isArray(values) &&
      values.length === length &&
      typeof id === 'string' &&
      UUID_RE.test(id)
    )
      return values;
  } catch {
    // An unreadable cursor is refused below.
  }
  throw gqlError('INVALID_INPUT', 'Invalid cursor');
}

// One forward page of rows in the order of `keys`, then `tieBreak`, then `id`
// descending. `load` must select `select` as `sortValues` (the keys' values in order, a
// JSON array) next to the row; the cursor carries those values and the id.
export async function paginateSorted<Row extends { id: string; sortValues: unknown[] }, T>(
  args: PageArgs,
  keys: SortKey[],
  tieBreak: SortKey[],
  id: SQL,
  where: SQL | undefined,
  load: (
    where: SQL | undefined,
    orderBy: SQL[],
    limit: number,
    select: SQL<unknown[]>,
  ) => Promise<Row[]>,
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
  const select = sql<unknown[]>`json_build_array(${sql.join(
    all.map((k) => k.sql),
    sql`, `,
  )})`;
  const after = args.after ? afterCursor(all, decodeCursor(args.after, all.length)) : undefined;
  const rows = await load(and(where, after), all.map(orderSql), limit + 1, select);
  const page = rows.slice(0, limit);
  const edges = page.map((row) => ({ node: map(row), cursor: encodeCursor(row.sortValues) }));
  return {
    nodes: edges.map((e) => e.node),
    edges,
    pageInfo: {
      hasNextPage: rows.length > limit,
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

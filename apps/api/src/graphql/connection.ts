import { and, asc, desc, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { gqlError } from './errors';
import { UUID_RE } from '../shared/lib';

// Relay pagination for Linear connections: first/after forward, last/before
// backward, ordered by createdAt (or updatedAt) newest first with id breaking ties.
// Cursors are opaque: base64url of "<iso timestamp>|<uuid>". Ordering and cursor
// comparison use the timestamp truncated to milliseconds, the precision the cursor
// carries, so a page boundary never repeats or skips a row.

export interface PageArgs {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
  orderBy?: 'createdAt' | 'updatedAt' | null;
}

export interface Connection<T> {
  nodes: T[];
  edges: { node: T; cursor: string }[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 250;

interface Keyed {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

function encode(ts: Date, id: string): string {
  return Buffer.from(`${ts.toISOString()}|${id}`).toString('base64url');
}

function decode(cursor: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!ts || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(ts)))
    throw gqlError('INVALID_INPUT', 'Invalid cursor');
  return { ts, id };
}

function pageSize(n: number | null | undefined, name: string): number {
  if (n == null) return DEFAULT_PAGE;
  if (n < 0 || n > MAX_PAGE)
    throw gqlError('INVALID_INPUT', `${name} must be between 0 and ${MAX_PAGE}`);
  return n;
}

// One page of rows. `load` runs the query with the page's extra condition, order
// and limit added to the caller's `where`; `map` turns a row into the node.
export async function paginate<Row extends Keyed, T>(
  args: PageArgs,
  cols: { id: AnyColumn; createdAt: AnyColumn; updatedAt: AnyColumn },
  where: SQL | undefined,
  load: (where: SQL | undefined, orderBy: SQL[], limit: number) => Promise<Row[]>,
  map: (row: Row) => T,
): Promise<Connection<T>> {
  const backward = args.last != null || args.before != null;
  const limit = backward ? pageSize(args.last, 'last') : pageSize(args.first, 'first');
  const field = args.orderBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
  const key = sql`date_trunc('milliseconds', ${cols[field]})`;
  const cursor = backward ? args.before : args.after;

  let after: SQL | undefined;
  if (cursor) {
    const c = decode(cursor);
    // Newest first: forward pages go to older rows, backward pages to newer ones.
    after = backward
      ? sql`(${key}, ${cols.id}) > (${c.ts}::timestamptz, ${c.id}::uuid)`
      : sql`(${key}, ${cols.id}) < (${c.ts}::timestamptz, ${c.id}::uuid)`;
  }
  const order = backward ? [asc(key), asc(cols.id)] : [desc(key), desc(cols.id)];
  const rows = await load(and(where, after), order, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (backward) page.reverse();

  const edges = page.map((row) => ({ node: map(row), cursor: encode(row[field], row.id) }));
  return {
    nodes: edges.map((e) => e.node),
    edges,
    pageInfo: {
      hasNextPage: backward ? args.before != null : hasMore,
      hasPreviousPage: backward ? hasMore : args.after != null,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

// One forward page of rows ordered by a computed number (`value`, ascending or
// descending), then newest first by createdAt and id, as Linear's `sort` options order
// a list. The cursor carries the value too: base64url of "<value>|<iso timestamp>|<uuid>".
// `load` must select the value as `sortValue`.
export async function paginateByValue<Row extends Keyed & { sortValue: number }, T>(
  args: PageArgs,
  cols: { id: AnyColumn; createdAt: AnyColumn },
  value: SQL<number>,
  direction: 'asc' | 'desc',
  where: SQL | undefined,
  load: (where: SQL | undefined, orderBy: SQL[], limit: number) => Promise<Row[]>,
  map: (row: Row) => T,
): Promise<Connection<T>> {
  if (args.last != null || args.before != null)
    throw gqlError('INVALID_INPUT', 'A sorted list pages forward only (first / after)');
  const limit = pageSize(args.first, 'first');
  const key = sql`date_trunc('milliseconds', ${cols.createdAt})`;
  let after: SQL | undefined;
  if (args.after) {
    const [raw, ts, id] = Buffer.from(args.after, 'base64url').toString().split('|');
    const v = Number(raw);
    if (!ts || !id || !UUID_RE.test(id) || Number.isNaN(Date.parse(ts)) || !Number.isFinite(v))
      throw gqlError('INVALID_INPUT', 'Invalid cursor');
    const beyond = direction === 'desc' ? sql`${value} < ${v}` : sql`${value} > ${v}`;
    after = sql`(${beyond} OR (${value} = ${v} AND (${key}, ${cols.id}) < (${ts}::timestamptz, ${id}::uuid)))`;
  }
  const order = [direction === 'desc' ? desc(value) : asc(value), desc(key), desc(cols.id)];
  const rows = await load(and(where, after), order, limit + 1);
  const page = rows.slice(0, limit);
  const edges = page.map((row) => ({
    node: map(row),
    cursor: Buffer.from(`${row.sortValue}|${row.createdAt.toISOString()}|${row.id}`).toString(
      'base64url',
    ),
  }));
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

// Whether a connection field was asked for its first page with no cursor, filter or
// backward paging — the case a request-scoped loader can answer from rows it already
// holds (connectionOf).
export function isFirstPage(args: PageArgs & { filter?: unknown }): boolean {
  return args.after == null && args.before == null && args.last == null && args.filter == null;
}

// A first-page connection built from rows already loaded, ordered and cut exactly as
// paginate orders and cuts them (newest first by createdAt or updatedAt, then id).
export function connectionOf<Row extends Keyed, T>(
  rows: Row[],
  args: PageArgs,
  map: (row: Row) => T,
): Connection<T> {
  const limit = pageSize(args.first, 'first');
  const field = args.orderBy === 'updatedAt' ? 'updatedAt' : 'createdAt';
  const ms = (d: Date) => Math.floor(d.getTime());
  const sorted = [...rows].sort(
    (a, b) => ms(b[field]) - ms(a[field]) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );
  const page = sorted.slice(0, limit);
  const edges = page.map((row) => ({ node: map(row), cursor: encode(row[field], row.id) }));
  return {
    nodes: edges.map((e) => e.node),
    edges,
    pageInfo: {
      hasNextPage: sorted.length > limit,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

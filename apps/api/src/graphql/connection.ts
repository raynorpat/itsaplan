import { and, asc, desc, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { gqlError } from './errors';

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!ts || !id || !UUID.test(id) || Number.isNaN(Date.parse(ts)))
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

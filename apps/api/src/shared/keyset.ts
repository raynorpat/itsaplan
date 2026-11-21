import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { HttpError, UUID_RE } from './lib';

// Keyset pagination for newest-first lists ordered by (created_at DESC, id DESC).
// The cursor is the last returned row's created_at (full-precision text, so it
// round-trips without the millisecond truncation iso() applies) and its uuid id,
// joined by '|'. Ids are random UUIDs, so created_at carries the order and id only
// breaks ties.

const CURSOR = /^([^|]+)\|(.+)$/;

// The cursor for the row a page ended on. cursorTs is `created_at::text`.
export function encodeCursor(row: { cursorTs: string; id: string }): string {
  return `${row.cursorTs}|${row.id}`;
}

// WHERE condition selecting the rows after the cursor, or undefined for the first
// page. A malformed cursor is a 400.
export function afterCursor(
  createdAt: AnyColumn,
  id: AnyColumn,
  cursor: string | undefined,
): SQL | undefined {
  if (!cursor) return undefined;
  const m = CURSOR.exec(cursor);
  if (!m || Number.isNaN(Date.parse(m[1])) || !UUID_RE.test(m[2]))
    throw new HttpError(400, 'Invalid cursor');
  return sql`(${createdAt}, ${id}) < (${m[1]}::timestamptz, ${m[2]}::uuid)`;
}

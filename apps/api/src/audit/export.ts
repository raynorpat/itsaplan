import { auditEntry, db, user } from '@repo/db';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { type AuthUser, assertWorkspaceRole } from '../shared/access';
import { HttpError, UUID_RE } from '../shared/lib';
import { shownNameSql } from '../shared/user-name';
import { recordAudit } from './store';
import { AUDIT_TYPES } from './types';

// The audit log as a CSV download (owners and admins), and the record of CSV exports
// the web builds itself (dashboards and their widgets). Every export is recorded as
// `dataExported`.

// At most this many entries in one export; narrow the filters for more.
export const MAX_EXPORT_ROWS = 100_000;

const HEADERS = ['Date', 'Type', 'Actor', 'Actor email', 'IP', 'Country', 'Method', 'Details'];

// A spreadsheet would run a cell starting with one of these as a formula, so such a
// cell gets a leading apostrophe (the dashboards' CSV does the same).
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export interface AuditExportFilters {
  type?: string;
  actorId?: string;
  ip?: string;
  from?: string;
  to?: string;
}

function readFilters(query: Record<string, unknown>): AuditExportFilters {
  const out: AuditExportFilters = {};
  const text = (key: keyof AuditExportFilters) => {
    const value = query[key];
    if (value === undefined || value === '') return;
    if (typeof value !== 'string') throw new HttpError(400, `${key} must be a string`);
    out[key] = value;
  };
  for (const key of ['type', 'actorId', 'ip', 'from', 'to'] as const) text(key);
  if (out.type && !(out.type in AUDIT_TYPES)) throw new HttpError(400, 'Unknown audit type');
  if (out.actorId && !UUID_RE.test(out.actorId)) throw new HttpError(400, 'actorId must be an id');
  for (const key of ['from', 'to'] as const)
    if (out[key] && Number.isNaN(Date.parse(out[key]!)))
      throw new HttpError(400, `${key} must be a date`);
  return out;
}

function whereOf(f: AuditExportFilters): SQL | undefined {
  return and(
    f.type ? eq(auditEntry.type, f.type) : undefined,
    f.actorId ? eq(auditEntry.actorId, f.actorId) : undefined,
    f.ip ? eq(auditEntry.ip, f.ip) : undefined,
    f.from ? gte(auditEntry.createdAt, new Date(f.from)) : undefined,
    f.to ? lte(auditEntry.createdAt, new Date(f.to)) : undefined,
  );
}

// Entries read per query while streaming an export.
const EXPORT_BATCH = 500;

function csvLine(row: {
  createdAt: Date;
  type: string;
  actorName: string | null;
  actorEmail: string | null;
  ip: string | null;
  countryCode: string | null;
  requestInformation: unknown;
  metadata: unknown;
}): string {
  const info = (row.requestInformation ?? {}) as { method?: unknown };
  return [
    row.createdAt.toISOString(),
    row.type,
    row.actorName,
    row.actorEmail,
    row.ip,
    row.countryCode,
    info.method,
    row.metadata ? JSON.stringify(row.metadata) : '',
  ]
    .map(cell)
    .join(',');
}

// The filtered entries, newest first, as RFC 4180 CSV (CRLF line ends, every data cell
// quoted), streamed in batches of 500 read by (created_at, id) so a large export never
// sits in memory whole. The export is recorded first, with its filters and row count.
export async function exportAuditCsv(
  actor: AuthUser,
  query: Record<string, unknown>,
): Promise<{ stream: ReadableStream<Uint8Array>; rows: number; filters: AuditExportFilters }> {
  await assertWorkspaceRole(actor, 'admin');
  const filters = readFilters(query);
  const where = whereOf(filters);
  const [{ count }] = (await db.select({ count: sql<number>`count(*)::int` }).from(
    db
      .select({ one: sql`1` })
      .from(auditEntry)
      .where(where)
      .limit(MAX_EXPORT_ROWS)
      .as('picked'),
  )) as [{ count: number }];
  await recordAudit(
    'dataExported',
    { kind: 'auditLog', rows: count, filters },
    { actorId: actor.id },
  );
  const encoder = new TextEncoder();
  let sent = 0;
  // The last row sent: its time as Postgres text, since a JS Date drops microseconds.
  let after: { at: string; id: string } | null = null;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(`${HEADERS.join(',')}\r\n`));
        return;
      }
      const take = Math.min(EXPORT_BATCH, count - sent);
      if (take <= 0) return controller.close();
      const page = await db
        .select({
          id: auditEntry.id,
          at: sql<string>`${auditEntry.createdAt}::text`,
          createdAt: auditEntry.createdAt,
          type: auditEntry.type,
          actorName: shownNameSql,
          actorEmail: user.email,
          ip: auditEntry.ip,
          countryCode: auditEntry.countryCode,
          requestInformation: auditEntry.requestInformation,
          metadata: auditEntry.metadata,
        })
        .from(auditEntry)
        .leftJoin(user, eq(user.id, auditEntry.actorId))
        .where(
          and(
            where,
            after
              ? sql`(${auditEntry.createdAt}, ${auditEntry.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(auditEntry.createdAt), desc(auditEntry.id))
        .limit(take);
      if (page.length === 0) return controller.close();
      sent += page.length;
      const last = page[page.length - 1]!;
      after = { at: last.at, id: last.id };
      controller.enqueue(encoder.encode(page.map((r) => `${csvLine(r)}\r\n`).join('')));
    },
  });
  return { stream, rows: count, filters };
}

const EXPORT_KINDS = new Set(['dashboard', 'widget']);

// Records a CSV the web built from data the person could already see (a dashboard or a
// widget): members, admins and owners, who are the people with dashboards.
export async function recordWebExport(actor: AuthUser, body: unknown): Promise<void> {
  await assertWorkspaceRole(actor, 'member');
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof input.kind !== 'string' || !EXPORT_KINDS.has(input.kind))
    throw new HttpError(400, 'kind must be dashboard or widget');
  if (typeof input.id !== 'string' || !input.id || input.id.length > 200)
    throw new HttpError(400, 'id is required');
  if (typeof input.name !== 'string' || input.name.length > 500)
    throw new HttpError(400, 'name must be a string');
  if (typeof input.rows !== 'number' || !Number.isInteger(input.rows) || input.rows < 0)
    throw new HttpError(400, 'rows must be a whole number');
  await recordAudit(
    'dataExported',
    {
      kind: input.kind,
      entityType: input.kind,
      entityId: input.id,
      name: input.name,
      rows: input.rows,
    },
    { actorId: actor.id },
  );
}

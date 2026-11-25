import { auditEntry, db, oauthClient } from '@repo/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { currentAuth } from '../shared/request-auth';
import {
  currentAuditRequest,
  MAX_OPERATION,
  noteAuditRequest,
  type AuditRequestDetails,
} from './context';
import type { AuditType } from './types';

// Writes the audit log (Linear's AuditEntry). An action with a transaction records its
// entry in it, so the two succeed or fail together. An action without one records
// directly, and a failed write lets the action go ahead: the failure is logged and the
// next entry written in this process says how many were missed.

export type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tx = AuditTx;

// Failed sign-ins from one address and IP within this window are one entry.
const FOLD_MS = 10 * 60_000;
// Past this many addresses from one IP in the window, further addresses add to one
// entry for the IP, so changing the address cannot flood the log either.
const MAX_ADDRESSES_PER_IP = 20;
// The longest attempted address kept (an email address is at most 320 characters).
const MAX_ADDRESS = 320;

let missed = 0;

// The OAuth application's name for a request made with its token, read once per
// request (the details object keeps it), on the writer's own transaction when it has
// one so a write never waits for a second pool connection.
async function oauthAppName(details: AuditRequestDetails, executor: Tx | typeof db): Promise<void> {
  const app = details.oauthApp;
  if (!app || app.name !== null) return;
  const [row] = await executor
    .select({ name: oauthClient.name })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, app.id));
  app.name = row?.name ?? '';
}

// A refused sign-in authenticated nobody, so it records `none` whatever the request's
// default method is.
function requestInformation(
  details: AuditRequestDetails,
  type: AuditType,
): Record<string, unknown> {
  const info: Record<string, unknown> = {
    userAgent: details.userAgent,
    method: type === 'loginFailed' ? 'none' : details.method,
  };
  if (details.oauthApp) info.oauthApp = details.oauthApp;
  if (details.pipelineId) info.pipelineId = details.pipelineId;
  if (details.operation) info.operation = details.operation;
  return info;
}

// The GraphQL operation name, read the first time an entry of the request needs it.
async function resolveOperation(details: AuditRequestDetails): Promise<void> {
  const pending = details.pendingOperation;
  if (!pending) return;
  details.pendingOperation = undefined;
  const name = await pending().catch(() => null);
  details.operation = name ? name.slice(0, MAX_OPERATION) : null;
}

async function entryValues(
  type: AuditType,
  metadata: Record<string, unknown> | null,
  actorId: string | null | undefined,
  executor: Tx | typeof db,
) {
  const details = currentAuditRequest();
  await oauthAppName(details, executor);
  await resolveOperation(details);
  return {
    type,
    actorId: actorId === undefined ? (currentAuth()?.userId ?? null) : actorId,
    ip: details.ip,
    countryCode: details.countryCode,
    metadata,
    requestInformation: requestInformation(details, type),
  };
}

// Records an action. `actorId` defaults to the request's authenticated user.
export async function recordAudit(
  type: AuditType,
  metadata: Record<string, unknown> | null,
  opts: { tx?: Tx; actorId?: string | null } = {},
): Promise<void> {
  if (opts.tx) {
    await opts.tx
      .insert(auditEntry)
      .values(await entryValues(type, metadata, opts.actorId, opts.tx));
    return;
  }
  // The misses this entry reports; misses counted meanwhile stay for the next one.
  const reported = missed;
  const note = reported > 0 ? { ...(metadata ?? {}), missedEntries: reported } : metadata;
  try {
    await db.insert(auditEntry).values(await entryValues(type, note, opts.actorId, db));
    missed -= reported;
  } catch (err) {
    missed += 1;
    console.error('[audit] entry not written:', type, err);
  }
}

// Records a refused sign-in. Attempts for the same address from the same IP within 10
// minutes add to one entry's `attempts` (the latest reason is its `reason`, every reason
// given is in `reasons`). Past 20 addresses from one IP in the window, further addresses
// add to one entry for the IP (`scope: 'ip'`, `addresses` counting the attempts with an
// address that has no entry of its own), so neither repeating nor changing the address
// floods the log. The request is marked so better-auth's after hook adds no second entry.
export async function recordLoginFailed(address: string, reason: string): Promise<void> {
  const normalized = address.trim().toLowerCase().slice(0, MAX_ADDRESS);
  const ip = currentAuditRequest().ip;
  noteAuditRequest({ refusalRecorded: true });
  try {
    await db.transaction(async (tx) => {
      // One writer per IP, so concurrent attempts count addresses and attempts once.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`audit-login:${ip ?? ''}`}))`);
      const since = new Date(Date.now() - FOLD_MS);
      const recent = and(
        eq(auditEntry.type, 'loginFailed'),
        ip == null ? sql`${auditEntry.ip} IS NULL` : eq(auditEntry.ip, ip),
        gt(auditEntry.createdAt, since),
      );
      const fold = async (id: string, metadata: unknown, extra: Record<string, unknown>) => {
        const current = (metadata ?? {}) as Record<string, unknown>;
        const reasons = Array.isArray(current.reasons)
          ? (current.reasons as string[])
          : typeof current.reason === 'string'
            ? [current.reason]
            : [];
        await tx
          .update(auditEntry)
          .set({
            metadata: {
              ...current,
              ...extra,
              reason,
              reasons: reasons.includes(reason) ? reasons : [...reasons, reason],
              attempts: Number(current.attempts ?? 1) + 1,
            },
            updatedAt: new Date(),
          })
          .where(eq(auditEntry.id, id));
      };
      const [own] = await tx
        .select({ id: auditEntry.id, metadata: auditEntry.metadata })
        .from(auditEntry)
        .where(and(recent, sql`${auditEntry.metadata}->>'address' = ${normalized}`))
        .orderBy(desc(auditEntry.createdAt))
        .limit(1);
      if (own) return fold(own.id, own.metadata, {});
      const [{ count }] = (await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEntry)
        .where(and(recent, sql`${auditEntry.metadata}->>'address' IS NOT NULL`))) as [
        { count: number },
      ];
      if (count < MAX_ADDRESSES_PER_IP) {
        await recordAudit(
          'loginFailed',
          { address: normalized, reason, reasons: [reason], attempts: 1 },
          { tx, actorId: null },
        );
        return;
      }
      const [forIp] = await tx
        .select({ id: auditEntry.id, metadata: auditEntry.metadata })
        .from(auditEntry)
        .where(and(recent, sql`${auditEntry.metadata}->>'scope' = 'ip'`))
        .orderBy(desc(auditEntry.createdAt))
        .limit(1);
      if (forIp) {
        const addresses = Number((forIp.metadata as Record<string, unknown>).addresses ?? 1) + 1;
        return fold(forIp.id, forIp.metadata, { addresses });
      }
      await recordAudit(
        'loginFailed',
        { scope: 'ip', reason, reasons: [reason], addresses: 1, attempts: 1 },
        { tx, actorId: null },
      );
    });
  } catch (err) {
    missed += 1;
    console.error('[audit] entry not written: loginFailed', err);
  }
}

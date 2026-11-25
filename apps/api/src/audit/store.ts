import { auditEntry, db, oauthClient } from '@repo/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { currentAuth } from '../shared/request-auth';
import { currentAuditRequest, type AuditRequestDetails } from './context';
import type { AuditType } from './types';

// Writes the audit log (Linear's AuditEntry). An action with a transaction records its
// entry in it, so the two succeed or fail together. An action without one records
// directly, and a failed write lets the action go ahead: the failure is logged and the
// next entry written in this process says how many were missed.

export type AuditTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Tx = AuditTx;

// Failed sign-ins from one address and IP within this window are one entry.
const FOLD_MS = 10 * 60_000;

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

function requestInformation(details: AuditRequestDetails): Record<string, unknown> {
  const info: Record<string, unknown> = {
    userAgent: details.userAgent,
    method: details.method,
  };
  if (details.oauthApp) info.oauthApp = details.oauthApp;
  if (details.pipelineId) info.pipelineId = details.pipelineId;
  if (details.operation) info.operation = details.operation;
  return info;
}

async function entryValues(
  type: AuditType,
  metadata: Record<string, unknown> | null,
  actorId: string | null | undefined,
  executor: Tx | typeof db,
) {
  const details = currentAuditRequest();
  await oauthAppName(details, executor);
  return {
    type,
    actorId: actorId === undefined ? (currentAuth()?.userId ?? null) : actorId,
    ip: details.ip,
    countryCode: details.countryCode,
    metadata,
    requestInformation: requestInformation(details),
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
  const note = missed > 0 ? { ...(metadata ?? {}), missedEntries: missed } : metadata;
  try {
    await db.insert(auditEntry).values(await entryValues(type, note, opts.actorId, db));
    if (note !== metadata) missed = 0;
  } catch (err) {
    missed += 1;
    console.error('[audit] entry not written:', type, err);
  }
}

// Records a refused sign-in. Attempts for the same address from the same IP within 10
// minutes add to one entry's `attempts`, so repeated attempts cannot flood the log.
export async function recordLoginFailed(address: string, reason: string): Promise<void> {
  const normalized = address.trim().toLowerCase();
  const ip = currentAuditRequest().ip;
  try {
    await db.transaction(async (tx) => {
      // One writer per address and IP, so two attempts at once do not both add an entry.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`audit-login:${normalized}:${ip ?? ''}`}))`,
      );
      const since = new Date(Date.now() - FOLD_MS);
      const [existing] = await tx
        .select({ id: auditEntry.id })
        .from(auditEntry)
        .where(
          and(
            eq(auditEntry.type, 'loginFailed'),
            ip == null ? sql`${auditEntry.ip} IS NULL` : eq(auditEntry.ip, ip),
            sql`${auditEntry.metadata}->>'address' = ${normalized}`,
            gt(auditEntry.createdAt, since),
          ),
        )
        .orderBy(desc(auditEntry.createdAt))
        .limit(1);
      if (existing) {
        await tx
          .update(auditEntry)
          .set({
            metadata: sql`jsonb_set(${auditEntry.metadata}, '{attempts}', to_jsonb(COALESCE((${auditEntry.metadata}->>'attempts')::int, 1) + 1))`,
            updatedAt: new Date(),
          })
          .where(eq(auditEntry.id, existing.id));
        return;
      }
      await recordAudit(
        'loginFailed',
        { address: normalized, reason, attempts: 1 },
        { tx, actorId: null },
      );
    });
  } catch (err) {
    missed += 1;
    console.error('[audit] entry not written: loginFailed', err);
  }
}

import { auditEntry, db, organization } from '@repo/db';
import { eq, lt } from 'drizzle-orm';
import { getOrganization } from '../organization/store';
import { assertWorkspaceRole, type AuthUser } from '../shared/access';
import { HttpError } from '../shared/lib';
import { recordAudit } from './store';

// How long audit log entries are kept, chosen by owners (30 days by default). The
// worker's clean-up (/internal/audit/cleanup) deletes older entries.

export const AUDIT_RETENTIONS = ['30d', '90d', '1y', '2y', '3y', 'forever'] as const;
export type AuditRetention = (typeof AUDIT_RETENTIONS)[number];

const DAYS: Record<Exclude<AuditRetention, 'forever'>, number> = {
  '30d': 30,
  '90d': 90,
  '1y': 365,
  '2y': 730,
  '3y': 1095,
};

export async function getAuditRetention(): Promise<AuditRetention> {
  return (await getOrganization()).auditRetention as AuditRetention;
}

// The setting as owners and admins read it.
export async function readAuditSettings(user: AuthUser): Promise<{ retention: AuditRetention }> {
  await assertWorkspaceRole(user, 'admin');
  return { retention: await getAuditRetention() };
}

// Owners change the period; the change is itself recorded.
export async function setAuditRetention(
  user: AuthUser,
  value: unknown,
): Promise<{ retention: AuditRetention }> {
  await assertWorkspaceRole(user, 'owner');
  if (!(AUDIT_RETENTIONS as readonly unknown[]).includes(value))
    throw new HttpError(400, `retention must be one of ${AUDIT_RETENTIONS.join(', ')}`);
  const to = value as AuditRetention;
  const org = await getOrganization();
  const from = org.auditRetention as AuditRetention;
  await db.transaction(async (tx) => {
    await tx
      .update(organization)
      .set({ auditRetention: to, updatedAt: new Date() })
      .where(eq(organization.id, org.id));
    await recordAudit('auditRetentionChanged', { from, to }, { tx, actorId: user.id });
  });
  return { retention: to };
}

// Deletes entries older than the retention period; returns how many.
export async function cleanupAuditEntries(now: Date): Promise<number> {
  const retention = await getAuditRetention();
  if (retention === 'forever') return 0;
  const cutoff = new Date(now.getTime() - DAYS[retention] * 86_400_000);
  const removed = await db
    .delete(auditEntry)
    .where(lt(auditEntry.createdAt, cutoff))
    .returning({ id: auditEntry.id });
  return removed.length;
}

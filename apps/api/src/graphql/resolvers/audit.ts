import { auditEntry, db } from '@repo/db';
import { sql, type SQL } from 'drizzle-orm';
import { AUDIT_TYPES } from '../../audit/types';
import { assertWorkspaceRole } from '../../shared/access';
import { iso } from '../../shared/lib';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { compare, compareId, filterSql, refFilter } from '../filter';
import { userById } from './issue';
import { guard } from './mutations';

// Linear's audit log reads (audit/store.ts writes it): `auditEntries` and
// `auditEntryTypes`, for workspace owners and admins only (an OAuth token without the
// `admin` scope reads as a member, so it is refused too). Nothing edits or deletes an
// entry; Linear's schema has no mutation for it.

type EntryRow = typeof auditEntry.$inferSelect;

// The entity filters read the `entityType`, `entityId` and `entityIdentifier` keys the
// writers put in an entry's metadata.
const metadataKey = (key: string) => sql`${auditEntry.metadata}->>${key}`;

const ENTRY_FILTER = {
  id: (v: unknown, p: string) => compareId(auditEntry.id, v, p),
  type: (v: unknown, p: string) => compare(auditEntry.type, v, p),
  ip: (v: unknown, p: string) => compare(auditEntry.ip, v, p),
  countryCode: (v: unknown, p: string) => compare(auditEntry.countryCode, v, p),
  createdAt: (v: unknown, p: string) => compare(auditEntry.createdAt, v, p),
  updatedAt: (v: unknown, p: string) => compare(auditEntry.updatedAt, v, p),
  actor: (v: unknown, p: string) => refFilter(auditEntry.actorId, v, p),
  entityType: (v: unknown, p: string) => compare(metadataKey('entityType'), v, p),
  entityId: (v: unknown, p: string) => compare(metadataKey('entityId'), v, p),
  entityIdentifier: (v: unknown, p: string) => compare(metadataKey('entityIdentifier'), v, p),
};

const toEntry = (row: EntryRow) => ({
  id: row.id,
  type: row.type,
  actorId: row.actorId,
  ip: row.ip,
  countryCode: row.countryCode,
  metadata: row.metadata,
  requestInformation: row.requestInformation,
  archivedAt: null,
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
});

async function assertReader(ctx: GraphQLContext): Promise<void> {
  await assertWorkspaceRole(ctx.user, 'admin');
}

export const auditResolvers = {
  Query: {
    auditEntries: (_: unknown, args: PageArgs & { filter?: unknown }, ctx: GraphQLContext) =>
      guard(async () => {
        await assertReader(ctx);
        const where: SQL | undefined = filterSql(args.filter, ENTRY_FILTER);
        return paginate(
          args,
          { id: auditEntry.id, createdAt: auditEntry.createdAt, updatedAt: auditEntry.updatedAt },
          where,
          (w, order, limit) =>
            db
              .select()
              .from(auditEntry)
              .where(w)
              .orderBy(...order)
              .limit(limit),
          toEntry,
        );
      }),
    auditEntryTypes: (_: unknown, __: unknown, ctx: GraphQLContext) =>
      guard(async () => {
        await assertReader(ctx);
        return Object.entries(AUDIT_TYPES).map(([type, description]) => ({ type, description }));
      }),
  },
  AuditEntry: {
    actor: (e: { actorId: string | null }, _: unknown, ctx: GraphQLContext) =>
      userById(e.actorId, ctx.user.id),
  },
};

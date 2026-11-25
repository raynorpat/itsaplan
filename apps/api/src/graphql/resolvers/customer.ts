import { customer, customerNeed, customerStatus, customerTier, db, user } from '@repo/db';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { readsFeedback, visibleNeedsSql } from '../../feedback/access';
import { mapNeed } from '../../feedback/store';
import {
  createCustomer,
  customerIssueCountSql,
  deleteCustomer,
  getCustomer,
  mapCustomer,
  mergeCustomers,
  updateCustomer,
  upsertCustomer,
  visibleCustomersSql,
  type CustomerDto,
} from '../../customers/store';
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
  type ListItemDto,
  type ListItemInput,
  type ListKind,
} from '../../customers/statuses';
import type { GraphQLContext } from '../context';
import { loaders } from '../loaders';
import { pageSize, paginate, type PageArgs } from '../connection';
import { customerFilterSql } from '../customer-filter';
import { gqlError } from '../errors';
import { toNeed } from './customer-need';
import { userFor } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';

// Linear's Customers (customers/store.ts) with their statuses and tiers
// (customers/statuses.ts). Read while Customers is on by owners, admins and members
// (guests get empty lists and ENTITY_NOT_FOUND); customers are written by the same
// people, statuses and tiers by owners and admins. Data sources (integrations, Slack
// channels, unsync) are not supported.

const ITEM_FIELDS = ['id', 'name', 'displayName', 'color', 'description', 'position'];
const UPDATE_FIELDS = ['name', 'displayName', 'color', 'description', 'position'];

// The whole list as one connection page: a workspace has a handful of statuses and tiers.
function listConnection(items: ListItemDto[]) {
  const edges = items.map((node) => ({ node, cursor: node.id }));
  return {
    nodes: items,
    edges,
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

type Input = { input: ListItemInput & Record<string, unknown> };
type IdInput = { id: string; input: ListItemInput & Record<string, unknown> };

const listMutations = (kind: ListKind, payloadKey: 'status' | 'tier') => ({
  create: (_: unknown, { input }: Input, ctx: GraphQLContext) =>
    guard(async () => {
      onlySupported(input, ITEM_FIELDS, 'input');
      const item = await createItem(kind, ctx.user, input);
      return { success: true, lastSyncId: lastSyncId(), [payloadKey]: item };
    }),
  update: (_: unknown, { id, input }: IdInput, ctx: GraphQLContext) =>
    guard(async () => {
      onlySupported(input, UPDATE_FIELDS, 'input');
      const item = await updateItem(kind, ctx.user, id, input);
      return { success: true, lastSyncId: lastSyncId(), [payloadKey]: item };
    }),
  remove: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
    guard(async () => {
      await deleteItem(kind, ctx.user, id);
      return { success: true, lastSyncId: lastSyncId(), entityId: id };
    }),
});

const CREATE_FIELDS = [
  'id',
  'name',
  'domains',
  'externalIds',
  'mainSourceId',
  'ownerId',
  'statusId',
  'tierId',
  'revenue',
  'size',
  'logoUrl',
];
const CUSTOMER_UPDATE_FIELDS = CREATE_FIELDS.filter((f) => f !== 'id');
const UPSERT_FIELDS = [
  'id',
  'externalId',
  'name',
  'domains',
  'ownerId',
  'statusId',
  'tierId',
  'tierName',
  'revenue',
  'size',
  'logoUrl',
];

export const toCustomer = (dto: CustomerDto) => ({
  ...dto,
  archivedAt: null,
  slackChannelId: null,
  integration: null,
});

const customerPayload = (dto: CustomerDto) => ({
  success: true,
  lastSyncId: lastSyncId(),
  customer: toCustomer(dto),
});

type ListArgs = PageArgs & { filter?: unknown; sorts?: unknown; includeArchived?: boolean | null };

// Linear's CustomerSortInput: one key per entry, applied in order, then newest first.
function sortOrder(sorts: unknown, viewerId: string): SQL[] {
  if (!Array.isArray(sorts)) throw gqlError('INVALID_INPUT', 'sorts must be a list');
  const order: SQL[] = [];
  for (const entry of sorts) {
    const keys = entry && typeof entry === 'object' ? Object.keys(entry) : [];
    if (keys.length !== 1) throw gqlError('INVALID_INPUT', 'Each sort names exactly one field');
    const key = keys[0]!;
    const opts = (entry as Record<string, { order?: string; nulls?: string } | null>)[key] ?? {};
    const value = SORT_VALUES[key]?.(viewerId);
    if (!value) throw gqlError('INVALID_INPUT', `Sorting by ${key} is not supported`);
    const dir = opts.order === 'Descending' ? sql`DESC` : sql`ASC`;
    const nulls = opts.nulls === 'first' ? sql`NULLS FIRST` : sql`NULLS LAST`;
    order.push(sql`${value} ${dir} ${nulls}`);
  }
  return order;
}

const SORT_VALUES: Record<string, (viewerId: string) => SQL> = {
  name: () => sql`lower(${customer.name})`,
  createdAt: () => sql`${customer.createdAt}`,
  revenue: () => sql`${customer.revenue}`,
  size: () => sql`${customer.size}`,
  owner: () =>
    sql`(SELECT lower(coalesce(nullif(trim(${user.name}), ''), ${user.email})) FROM ${user} WHERE ${user.id} = ${customer.ownerId})`,
  status: () =>
    sql`(SELECT ${customerStatus.position} FROM ${customerStatus} WHERE ${customerStatus.id} = ${customer.statusId})`,
  tier: () =>
    sql`(SELECT ${customerTier.position} FROM ${customerTier} WHERE ${customerTier.id} = ${customer.tierId})`,
  approximateNeedCount: (viewerId) => customerIssueCountSql(viewerId, sql`${customer.id}`),
};

// A sorted list pages by position: the cursor is the offset of the next row.
function offsetOf(after: string | null | undefined): number {
  if (after == null) return 0;
  const raw = Buffer.from(after, 'base64url').toString();
  const n = raw.startsWith('o:') ? Number(raw.slice(2)) : NaN;
  if (!Number.isInteger(n) || n < 0) throw gqlError('INVALID_INPUT', 'Invalid cursor');
  return n;
}

async function listCustomers(args: ListArgs, ctx: GraphQLContext) {
  const where = and(
    await visibleCustomersSql(ctx.user.id),
    customerFilterSql(args.filter, ctx.user.id),
  );
  const map = (row: typeof customer.$inferSelect) => toCustomer(mapCustomer(row));
  if (args.sorts == null)
    return paginate(
      args,
      { id: customer.id, createdAt: customer.createdAt, updatedAt: customer.updatedAt },
      where,
      (w, order, limit) =>
        db
          .select()
          .from(customer)
          .where(w)
          .orderBy(...order)
          .limit(limit),
      map,
    );
  if (args.last != null || args.before != null)
    throw gqlError('INVALID_INPUT', 'A sorted list pages forward only (first / after)');
  const order = sortOrder(args.sorts, ctx.user.id);
  const limit = pageSize(args.first, 'first');
  const offset = offsetOf(args.after);
  const rows = await db
    .select()
    .from(customer)
    .where(where)
    .orderBy(...order, desc(customer.createdAt), desc(customer.id))
    .limit(limit + 1)
    .offset(offset);
  const edges = rows.slice(0, limit).map((row, i) => ({
    node: map(row),
    cursor: Buffer.from(`o:${offset + i + 1}`).toString('base64url'),
  }));
  return {
    nodes: edges.map((e) => e.node),
    edges,
    pageInfo: {
      hasNextPage: rows.length > limit,
      hasPreviousPage: offset > 0,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges[edges.length - 1]?.cursor ?? null,
    },
  };
}

const statusMutations = listMutations('status', 'status');
const tierMutations = listMutations('tier', 'tier');

export const customerResolvers = {
  Query: {
    customer: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toCustomer(await getCustomer(ctx.user.id, id))),
    customers: (_: unknown, args: ListArgs, ctx: GraphQLContext) => listCustomers(args, ctx),
    customerStatuses: async (_: unknown, __: unknown, ctx: GraphQLContext) =>
      listConnection(await listItems('status', ctx.user.id)),
    customerStatus: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(() => getItem('status', ctx.user.id, id)),
    customerTiers: async (_: unknown, __: unknown, ctx: GraphQLContext) =>
      listConnection(await listItems('tier', ctx.user.id)),
    customerTier: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(() => getItem('tier', ctx.user.id, id)),
  },
  Mutation: {
    customerCreate: (_: unknown, { input }: Input, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, CREATE_FIELDS, 'input');
        return customerPayload(await createCustomer(ctx.user, input));
      }),
    customerUpdate: (_: unknown, { id, input }: IdInput, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, CUSTOMER_UPDATE_FIELDS, 'input');
        return customerPayload(await updateCustomer(ctx.user, id, input));
      }),
    customerUpsert: (_: unknown, { input }: Input, ctx: GraphQLContext) =>
      guard(async () => {
        onlySupported(input, UPSERT_FIELDS, 'input');
        return customerPayload(await upsertCustomer(ctx.user, input));
      }),
    customerDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => ({
        success: true,
        lastSyncId: lastSyncId(),
        entityId: await deleteCustomer(ctx.user, id),
      })),
    customerMerge: (
      _: unknown,
      args: { sourceCustomerId: string; targetCustomerId: string },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        customerPayload(
          await mergeCustomers(ctx.user, args.sourceCustomerId, args.targetCustomerId),
        ),
      ),
    customerUnsync: () =>
      guard(async () => {
        throw gqlError('INVALID_INPUT', 'Customer data sources are not supported');
      }),
    customerStatusCreate: statusMutations.create,
    customerStatusUpdate: statusMutations.update,
    customerStatusDelete: statusMutations.remove,
    customerTierCreate: tierMutations.create,
    customerTierUpdate: tierMutations.update,
    customerTierDelete: tierMutations.remove,
  },
  CustomerNeed: {
    // Null while Customers is off and for guests.
    customer: async (n: { customerId: string | null }, _: unknown, ctx: GraphQLContext) => {
      if (!n.customerId || !(await loaders(ctx).readsCustomers())) return null;
      const dto = await loaders(ctx).customer.load(n.customerId);
      return dto ? toCustomer(dto) : null;
    },
  },
  Customer: {
    status: (c: CustomerDto, _: unknown, ctx: GraphQLContext) =>
      loaders(ctx).customerStatus.load(c.statusId),
    tier: (c: CustomerDto, _: unknown, ctx: GraphQLContext) =>
      c.tierId ? loaders(ctx).customerTier.load(c.tierId) : null,
    owner: (c: CustomerDto, _: unknown, ctx: GraphQLContext) => userFor(ctx, c.ownerId),
    approximateNeedCount: (c: CustomerDto, _: unknown, ctx: GraphQLContext) =>
      loaders(ctx).customerIssueCount.load(c.id),
    // The customer's active requests on issues the viewer can see.
    needs: async (c: CustomerDto, _: unknown, ctx: GraphQLContext) => {
      if (!(await readsFeedback(ctx.user.id))) return [];
      const rows = await db
        .select()
        .from(customerNeed)
        .where(
          and(
            eq(customerNeed.customerId, c.id),
            isNull(customerNeed.archivedAt),
            visibleNeedsSql(ctx.user.id),
          ),
        )
        .orderBy(sql`${customerNeed.createdAt} DESC`);
      return rows.map((row) => toNeed(mapNeed(row)));
    },
  },
};

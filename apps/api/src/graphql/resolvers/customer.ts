import { customer, customerNeed, db } from '@repo/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { readsFeedback, visibleNeedsSql } from '../../feedback/access';
import { mapNeed } from '../../feedback/store';
import {
  createCustomer,
  customerIssueCount,
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
  itemById,
  listItems,
  updateItem,
  type ListItemDto,
  type ListItemInput,
  type ListKind,
} from '../../customers/statuses';
import type { GraphQLContext } from '../context';
import { loaders } from '../loaders';
import { paginate, type PageArgs } from '../connection';
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

const toCustomer = (dto: CustomerDto) => ({
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

async function listCustomers(args: ListArgs, ctx: GraphQLContext) {
  if (args.sorts != null) throw gqlError('INVALID_INPUT', 'Argument sorts is not supported');
  return paginate(
    args,
    { id: customer.id, createdAt: customer.createdAt, updatedAt: customer.updatedAt },
    and(await visibleCustomersSql(ctx.user.id), customerFilterSql(args.filter, ctx.user.id)),
    (w, order, limit) =>
      db
        .select()
        .from(customer)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toCustomer(mapCustomer(row)),
  );
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
    status: (c: CustomerDto) => itemById('status', c.statusId),
    tier: (c: CustomerDto) => itemById('tier', c.tierId),
    owner: (c: CustomerDto, _: unknown, ctx: GraphQLContext) => userFor(ctx, c.ownerId),
    approximateNeedCount: (c: CustomerDto) => customerIssueCount(c.id),
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

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
import { guard, lastSyncId, onlySupported } from './mutations';

// Linear's Customers: customer statuses and tiers (customers/statuses.ts). Read while
// Customers is on by owners, admins and members (guests get empty lists); created,
// changed and deleted by owners and admins.

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

const statusMutations = listMutations('status', 'status');
const tierMutations = listMutations('tier', 'tier');

export const customerResolvers = {
  Query: {
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
    customerStatusCreate: statusMutations.create,
    customerStatusUpdate: statusMutations.update,
    customerStatusDelete: statusMutations.remove,
    customerTierCreate: tierMutations.create,
    customerTierUpdate: tierMutations.update,
    customerTierDelete: tierMutations.remove,
  },
};

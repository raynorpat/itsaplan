import { trustedOrigins } from '@repo/auth';
import { db, favorite, team } from '@repo/db';
import { eq } from 'drizzle-orm';
import { customerUrl } from '../../customers/store';
import { getDashboard } from '../../dashboards/store';
import { documentUrl } from '../../documents/store';
import {
  createFavorite,
  deleteFavorite,
  getFavorite,
  mapFavorite,
  updateFavorite,
  visibleFavoritesWhere,
  type FavoriteDto,
} from '../../favorites/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { customViewResolvers } from './custom-view';
import { customerResolvers } from './customer';
import { cycleResolvers } from './cycle';
import { documentResolvers } from './document';
import { issueResolvers } from './issue';
import { issueLabelResolvers } from './issue-label';
import { guard, lastSyncId } from './mutations';
import { projectResolvers } from './project';
import { teamResolvers } from './team';

// Linear's Favorite over GraphQL (favorites/store.ts). A favorite's target field reads
// the item through that item's own query, so it follows the same access rules, and
// reads null when the viewer can no longer see it or it is archived or trashed.

type Input = Record<string, unknown>;
type Resolver = (parent: unknown, args: { id: string }, ctx: GraphQLContext) => unknown;

// The root query that reads each kind of target.
const QUERIES: Record<string, () => Resolver> = {
  issue: () => issueResolvers.Query.issue as Resolver,
  project: () => projectResolvers.Query.project as Resolver,
  customView: () => customViewResolvers.Query.customView as Resolver,
  cycle: () => cycleResolvers.Query.cycle as Resolver,
  document: () => documentResolvers.Query.document as Resolver,
  label: () => issueLabelResolvers.Query.issueLabel as Resolver,
  projectLabel: () => projectResolvers.Query.projectLabel as Resolver,
  customer: () => customerResolvers.Query.customer as Resolver,
  team: () => teamResolvers.Query.team as Resolver,
  user: () => teamResolvers.Query.user as Resolver,
};

type Target = Record<string, unknown> & { id: string };

// One read of a favorite's target per request.
const targets = new WeakMap<FavoriteDto, Promise<Target | null>>();

async function readTarget(f: FavoriteDto, ctx: GraphQLContext): Promise<Target | null> {
  const query = QUERIES[f.type];
  if (!query || !f.targetId) return null;
  try {
    const found = (await query()(undefined, { id: f.targetId }, ctx)) as Target | null;
    if (!found || found.archivedAt || found.trashed) return null;
    return found;
  } catch {
    return null;
  }
}

function target(f: FavoriteDto, ctx: GraphQLContext): Promise<Target | null> {
  let read = targets.get(f);
  if (!read) {
    read = readTarget(f, ctx);
    targets.set(f, read);
  }
  return read;
}

const targetOfType =
  (type: FavoriteDto['type']) => (f: FavoriteDto, _: unknown, ctx: GraphQLContext) =>
    f.type === type ? target(f, ctx) : null;

const origin = () => trustedOrigins[0] ?? '';

async function teamKey(teamId: unknown): Promise<string | null> {
  if (typeof teamId !== 'string') return null;
  const [row] = await db.select({ key: team.key }).from(team).where(eq(team.id, teamId));
  return row?.key ?? null;
}

// The web page of a fixed view, by Linear's view type; a team's fixed view opens the
// team.
const PREDEFINED_PATHS: Record<string, string> = {
  myIssues: '/my-issues',
  inbox: '/inbox',
  projects: '/projects',
  views: '/views',
  initiatives: '/initiatives',
  dashboards: '/dashboards',
};

async function favoriteUrl(f: FavoriteDto, ctx: GraphQLContext): Promise<string | null> {
  switch (f.type) {
    case 'folder':
    case 'label':
    case 'projectLabel':
    case 'user':
      return null;
    case 'dashboard': {
      if (!f.targetId) return null;
      const found = await getDashboard(ctx.user, f.targetId).catch(() => null);
      return found ? `${origin()}/dashboards/${found.id}` : null;
    }
    case 'predefinedView': {
      if (f.teamId) {
        const key = await teamKey(f.teamId);
        return key ? `${origin()}/team/${encodeURIComponent(key)}` : null;
      }
      const path = PREDEFINED_PATHS[f.predefinedViewType ?? ''];
      return path ? `${origin()}${path}` : null;
    }
    default:
      break;
  }
  const t = await target(f, ctx);
  if (!t) return null;
  switch (f.type) {
    case 'issue':
    case 'project':
      return typeof t.url === 'string' ? t.url : null;
    case 'document':
      return documentUrl(t as unknown as Parameters<typeof documentUrl>[0]);
    case 'customer':
      return typeof t.slugId === 'string' ? customerUrl(t.slugId) : null;
    case 'team':
      return typeof t.key === 'string' ? `${origin()}/team/${encodeURIComponent(t.key)}` : null;
    case 'cycle': {
      const key = await teamKey(t.teamId);
      return key ? `${origin()}/team/${encodeURIComponent(key)}/cycles/${t.number}` : null;
    }
    case 'customView': {
      const key = await teamKey(t.teamId);
      return key ? `${origin()}/team/${encodeURIComponent(key)}/view/${t.id}` : null;
    }
    default:
      return null;
  }
}

async function listFavorites(ctx: GraphQLContext, args: PageArgs, parentId?: string) {
  const where = await visibleFavoritesWhere(
    ctx.user,
    parentId ? eq(favorite.parentId, parentId) : undefined,
  );
  return paginate(
    args,
    { id: favorite.id, createdAt: favorite.createdAt, updatedAt: favorite.updatedAt },
    where,
    (w, order, limit) =>
      db
        .select()
        .from(favorite)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    mapFavorite,
  );
}

const payload = (f: FavoriteDto) => ({ success: true, lastSyncId: lastSyncId(), favorite: f });

export const favoriteResolvers = {
  Query: {
    favorites: (_: unknown, args: PageArgs, ctx: GraphQLContext) =>
      guard(() => listFavorites(ctx, args)),
    favorite: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(() => getFavorite(ctx.user, id)),
  },
  Mutation: {
    favoriteCreate: (_: unknown, { input }: { input: Input }, ctx: GraphQLContext) =>
      guard(async () => payload(await createFavorite(ctx.user, { ...input }))),
    favoriteUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) => guard(async () => payload(await updateFavorite(ctx.user, id, { ...input }))),
    favoriteDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => ({
        success: true,
        lastSyncId: lastSyncId(),
        entityId: await deleteFavorite(ctx.user, id),
      })),
  },
  Favorite: {
    archivedAt: () => null,
    parent: async (f: FavoriteDto, _: unknown, ctx: GraphQLContext) =>
      f.parentId ? getFavorite(ctx.user, f.parentId).catch(() => null) : null,
    children: (f: FavoriteDto, args: PageArgs, ctx: GraphQLContext) =>
      f.type === 'folder'
        ? listFavorites(ctx, args, f.id)
        : {
            nodes: [],
            edges: [],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: null,
              endCursor: null,
            },
          },
    owner: (f: FavoriteDto, _: unknown, ctx: GraphQLContext) =>
      (teamResolvers.Query.user as Resolver)(undefined, { id: f.ownerId }, ctx),
    url: (f: FavoriteDto, _: unknown, ctx: GraphQLContext) => favoriteUrl(f, ctx),
    issue: targetOfType('issue'),
    project: targetOfType('project'),
    customView: targetOfType('customView'),
    cycle: targetOfType('cycle'),
    document: targetOfType('document'),
    label: targetOfType('label'),
    projectLabel: targetOfType('projectLabel'),
    customer: targetOfType('customer'),
    team: targetOfType('team'),
    user: targetOfType('user'),
    predefinedViewTeam: async (f: FavoriteDto, _: unknown, ctx: GraphQLContext) => {
      if (f.type !== 'predefinedView' || !f.teamId) return null;
      try {
        return await (teamResolvers.Query.team as Resolver)(undefined, { id: f.teamId }, ctx);
      } catch {
        return null;
      }
    },
  },
};

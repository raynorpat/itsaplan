import { trustedOrigins } from '@repo/auth';
import { db, favorite } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { customerUrl } from '../../customers/store';
import { documentUrl } from '../../documents/store';
import { visibleFavoritesSql } from '../../favorites/access';
import {
  createFavorite,
  deleteFavorite,
  getFavorite,
  mapFavorite,
  updateFavorite,
  type FavoriteDto,
} from '../../favorites/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { loaders } from '../loaders';
import { customViewResolvers } from './custom-view';
import { toCustomer } from './customer';
import { toCycle } from './cycle';
import { documentResolvers } from './document';
import { toIssue } from './issue';
import { toIssueLabel } from './issue-label';
import { guard, lastSyncId } from './mutations';
import { projectResolvers, toProject } from './project';
import { toTeam } from './team';
import { toGraphQLUser } from './user';

// Linear's Favorite over GraphQL (favorites/store.ts). Per request, one query reads all
// of the viewer's favorites with whether each is visible (favorites/access.ts), so the
// list, its folders' children, `parent` and every target agree and the access
// condition is built once. A target reads null unless its favorite is visible; the
// common kinds load through the request loaders in batches, the rest through their
// own root query (which applies the same access rules).

type Input = Record<string, unknown>;
type Resolver = (parent: unknown, args: { id: string }, ctx: GraphQLContext) => unknown;
type Target = Record<string, unknown> & { id: string };

interface Favorites {
  rows: Map<string, FavoriteDto>;
  visible: Set<string>;
}

const perRequest = new WeakMap<GraphQLContext, Promise<Favorites>>();

function viewerFavorites(ctx: GraphQLContext): Promise<Favorites> {
  let found = perRequest.get(ctx);
  if (!found) {
    found = (async () => {
      const visibleSql = await visibleFavoritesSql(ctx.user);
      const rows = await db
        .select({ row: favorite, visible: sql<boolean>`(${visibleSql})` })
        .from(favorite)
        .where(eq(favorite.ownerId, ctx.user.id));
      return {
        rows: new Map(rows.map((r) => [r.row.id, mapFavorite(r.row)])),
        visible: new Set(rows.filter((r) => r.visible).map((r) => r.row.id)),
      };
    })();
    perRequest.set(ctx, found);
  }
  return found;
}

// A mutation changes the viewer's favorites: later fields read them again.
const forget = (ctx: GraphQLContext) => perRequest.delete(ctx);

const isVisible = async (f: FavoriteDto, ctx: GraphQLContext) =>
  (await viewerFavorites(ctx)).visible.has(f.id);

// Kinds without a request loader, read through their root query.
const QUERIES: Record<string, () => Resolver> = {
  customView: () => customViewResolvers.Query.customView as Resolver,
  document: () => documentResolvers.Query.document as Resolver,
  projectLabel: () => projectResolvers.Query.projectLabel as Resolver,
};

async function loadTarget(f: FavoriteDto, ctx: GraphQLContext): Promise<Target | null> {
  const id = f.targetId;
  if (!id) return null;
  const l = loaders(ctx);
  switch (f.type) {
    case 'issue': {
      const row = await l.issue.load(id);
      return row ? (toIssue(row) as Target) : null;
    }
    case 'project': {
      const row = await l.project.load(id);
      return row ? (toProject(row) as Target) : null;
    }
    case 'cycle': {
      const row = await l.cycle.load(id);
      return row ? (toCycle(row) as Target) : null;
    }
    case 'team': {
      const row = await l.team.load(id);
      return row ? (toTeam(row) as Target) : null;
    }
    case 'user': {
      const row = await l.user.load(id);
      return row ? (toGraphQLUser(row, ctx.user.id) as Target) : null;
    }
    case 'label': {
      const row = await l.label.load(id);
      return row ? (toIssueLabel(row) as Target) : null;
    }
    case 'customer': {
      const row = await l.customer.load(id);
      return row ? (toCustomer(row) as Target) : null;
    }
    default: {
      const query = QUERIES[f.type];
      if (!query) return null;
      try {
        return ((await query()(undefined, { id }, ctx)) as Target | null) ?? null;
      } catch {
        return null;
      }
    }
  }
}

// One read of a favorite's target per request.
const targets = new WeakMap<FavoriteDto, Promise<Target | null>>();

function target(f: FavoriteDto, ctx: GraphQLContext): Promise<Target | null> {
  let read = targets.get(f);
  if (!read) {
    read = (async () => ((await isVisible(f, ctx)) ? loadTarget(f, ctx) : null))();
    targets.set(f, read);
  }
  return read;
}

const targetOfType =
  (type: FavoriteDto['type']) => (f: FavoriteDto, _: unknown, ctx: GraphQLContext) =>
    f.type === type ? target(f, ctx) : null;

const origin = () => trustedOrigins[0] ?? '';

async function teamKey(teamId: unknown, ctx: GraphQLContext): Promise<string | null> {
  if (typeof teamId !== 'string') return null;
  return (await loaders(ctx).team.load(teamId))?.key ?? null;
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

// The item's web page; null for a folder, a kind without a page, and a favorite whose
// item the viewer cannot see.
async function favoriteUrl(f: FavoriteDto, ctx: GraphQLContext): Promise<string | null> {
  if (f.type === 'folder' || f.type === 'label' || f.type === 'projectLabel' || f.type === 'user')
    return null;
  if (!(await isVisible(f, ctx))) return null;
  switch (f.type) {
    case 'dashboard':
      return f.targetId ? `${origin()}/dashboards/${f.targetId}` : null;
    case 'predefinedView': {
      if (f.teamId) {
        const key = await teamKey(f.teamId, ctx);
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
      const key = await teamKey(t.teamId, ctx);
      return key ? `${origin()}/team/${encodeURIComponent(key)}/cycles/${t.number}` : null;
    }
    case 'customView': {
      const key = await teamKey(t.teamId, ctx);
      return key ? `${origin()}/team/${encodeURIComponent(key)}/view/${t.id}` : null;
    }
    default:
      return null;
  }
}

async function listFavorites(ctx: GraphQLContext, args: PageArgs, parentId?: string) {
  const { visible } = await viewerFavorites(ctx);
  const ids = [...visible];
  return paginate(
    args,
    { id: favorite.id, createdAt: favorite.createdAt, updatedAt: favorite.updatedAt },
    and(
      ids.length ? inArray(favorite.id, ids) : sql`false`,
      parentId ? eq(favorite.parentId, parentId) : undefined,
    ),
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
      guard(async () => {
        const created = await createFavorite(ctx.user, { ...input });
        forget(ctx);
        return payload(created);
      }),
    favoriteUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Input },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        const updated = await updateFavorite(ctx.user, id, { ...input });
        forget(ctx);
        return payload(updated);
      }),
    favoriteDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const entityId = await deleteFavorite(ctx.user, id);
        forget(ctx);
        return { success: true, lastSyncId: lastSyncId(), entityId };
      }),
  },
  Favorite: {
    archivedAt: () => null,
    parent: async (f: FavoriteDto, _: unknown, ctx: GraphQLContext) =>
      f.parentId ? ((await viewerFavorites(ctx)).rows.get(f.parentId) ?? null) : null,
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
    owner: async (f: FavoriteDto, _: unknown, ctx: GraphQLContext) => {
      const row = await loaders(ctx).anyUser.load(f.ownerId);
      return row ? toGraphQLUser(row, ctx.user.id) : null;
    },
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
      if (f.type !== 'predefinedView' || !f.teamId || !(await isVisible(f, ctx))) return null;
      const row = await loaders(ctx).team.load(f.teamId);
      return row ? toTeam(row) : null;
    },
  },
};

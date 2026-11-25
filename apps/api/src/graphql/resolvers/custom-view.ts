import { db, issue, team, teamView } from '@repo/db';
import { and, eq, getTableColumns, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { assertTeamAccess, visibleTeamIds } from '../../shared/access';
import { HttpError } from '../../shared/lib';
import {
  createView,
  deleteView,
  deleteViewPreferences,
  getView,
  getViewPreferences,
  mapView,
  updateView,
  updateViewPreferences,
  upsertViewPreferences,
  viewPreferencesFor,
  type ViewPreferencesRow,
  isViewSharedWith,
  LIST_VIEW_TYPES,
  listPreferencesFor,
  type ListViewType,
  upsertListPreferences,
  type ViewRow,
  viewSharedWith,
} from '../../views/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { compare, compareId, filterSql, refFilter, type FieldHandlers } from '../filter';
import { issueFilterSql } from '../issue-filter';
import { customViewSortKeys, tieBreaks } from '../list-sorts';
import { paginateSorted } from '../sort';
import { getOrganization } from './organization';
import { listIssues, userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findTeam, teamFilter, toTeam } from './team';

// Linear's CustomView over the saved team views, and ViewPreferences for their
// layout. A shared view is visible when its team is (project 2 rules), and anyone who
// can see the team may change or delete it; a non-shared view is its
// owner's only.

const toCustomView = (row: ViewRow) => ({
  ...row,
  filters: row.filterData,
  modelName: 'Issue',
  archivedAt: null,
});

type GraphQLCustomView = ReturnType<typeof toCustomView>;

// GraphQL input objects have no prototype; JSON stored through Drizzle must be
// plain objects.
const plainJson = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);

const toViewPreferences = (row: ViewPreferencesRow) => ({ ...row, archivedAt: null });

function listViewType(value: unknown, path: string): ListViewType {
  if (!LIST_VIEW_TYPES.includes(value as ListViewType))
    throw gqlError(
      'INVALID_INPUT',
      `${path} must be customView with customViewId, or one of ${LIST_VIEW_TYPES.join(', ')}`,
    );
  return value as ListViewType;
}

// CustomViewFilter fields this API supports, as SQL over team_view.
const customViewFilter: FieldHandlers = {
  id: (v, p) => compareId(teamView.id, v, p),
  name: (v, p) => compare(teamView.name, v, p),
  createdAt: (v, p) => compare(teamView.createdAt, v, p),
  updatedAt: (v, p) => compare(teamView.updatedAt, v, p),
  shared: (v, p) => compare(teamView.shared, v, p),
  creator: (v, p) => refFilter(teamView.creatorUserId, v, p),
  // NullableTeamFilter: `null` tests for a view without a team (none exist here);
  // the other fields match the team.
  team: (v, p) => {
    const { null: isNullFilter, ...rest } = v as Record<string, unknown>;
    const parts: SQL[] = [];
    if (isNullFilter !== undefined && isNullFilter !== null)
      parts.push(isNullFilter ? isNull(teamView.teamId) : isNotNull(teamView.teamId));
    const match = filterSql(rest, teamFilter, p);
    if (match)
      parts.push(inArray(teamView.teamId, db.select({ id: team.id }).from(team).where(match)));
    return and(...parts) ?? sql`true`;
  },
};

// A view the viewer can see, by id or slug, or ENTITY_NOT_FOUND: its team is visible,
// and it is shared or theirs (a non-shared view is its owner's only).
async function findView(id: string, ctx: GraphQLContext): Promise<ViewRow> {
  const found = await getView(id);
  if (found && isViewSharedWith(found, ctx.user.id)) {
    try {
      await assertTeamAccess(found.teamId, ctx.user, 'see');
      return found;
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
    }
  }
  throw gqlError('ENTITY_NOT_FOUND', `Custom view ${id} not found`);
}

const UNSUPPORTED_VIEW_FIELDS = [
  'feedItemFilterData',
  'initiativeFilterData',
  'projectFilterData',
  'initiativeId',
  'projectId',
];

function checkViewInput(
  input: Record<string, unknown>,
  allowed: string[],
  ctx: GraphQLContext,
): void {
  onlySupported(input, allowed, 'input');
  for (const field of UNSUPPORTED_VIEW_FIELDS)
    if (input[field] != null) throw gqlError('INVALID_INPUT', `input.${field} is not supported`);
  // Linear makes the creator the owner; nobody hands a view to someone else.
  if (input.ownerId != null && input.ownerId !== ctx.user.id)
    throw gqlError('INVALID_INPUT', "input.ownerId must be the viewer's own id");
  if ('name' in input && (typeof input.name !== 'string' || !input.name.trim()))
    throw gqlError('INVALID_INPUT', 'input.name must not be empty');
}

const viewPayload = (row: ViewRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  customView: toCustomView(row),
});

const prefsPayload = (row: ViewPreferencesRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  viewPreferences: toViewPreferences(row),
});

// The preferences a user sees for a view: the organization's, with their own on top.
async function viewPreferencesValues(viewId: string, userId: string) {
  const org = await viewPreferencesFor(viewId, 'organization');
  const mine = await viewPreferencesFor(viewId, 'user', userId);
  if (!org && !mine) return null;
  return { ...(org?.preferences ?? {}), ...(mine?.preferences ?? {}) };
}

// A preferences row the viewer may change: its view is visible, and a user row is
// their own. A row without a saved view is always a user row.
async function findViewPreferences(id: string, ctx: GraphQLContext): Promise<ViewPreferencesRow> {
  const found = await getViewPreferences(id);
  if (found && (found.type === 'organization' || found.userId === ctx.user.id)) {
    if (found.customViewId) await findView(found.customViewId, ctx);
    return found;
  }
  throw gqlError('ENTITY_NOT_FOUND', `View preferences ${id} not found`);
}

export const customViewResolvers = {
  Query: {
    userViewPreferences: (_: unknown, { viewType }: { viewType: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const row = await listPreferencesFor(ctx.user.id, listViewType(viewType, 'viewType'));
        return row ? toViewPreferences(row) : null;
      }),
    customView: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toCustomView(await findView(id, ctx))),
    customViews: (
      _: unknown,
      args: PageArgs & { filter?: unknown; sort?: unknown },
      ctx: GraphQLContext,
    ) => {
      const scope = and(
        inArray(teamView.teamId, visibleTeamIds(ctx.user.id)),
        viewSharedWith(ctx.user.id),
        filterSql(args.filter, customViewFilter),
      );
      const keys = customViewSortKeys(args.sort);
      if (keys)
        return paginateSorted(
          args,
          keys,
          tieBreaks.customView,
          sql`${teamView.id}`,
          scope,
          (w, order, limit, select) =>
            db
              .select({ ...getTableColumns(teamView), sortValues: select })
              .from(teamView)
              .where(w)
              .orderBy(...order)
              .limit(limit),
          (row) => toCustomView(mapView(row)),
        );
      return paginate(
        args,
        { id: teamView.id, createdAt: teamView.createdAt, updatedAt: teamView.updatedAt },
        scope,
        (w, order, limit) =>
          db
            .select()
            .from(teamView)
            .where(w)
            .orderBy(...order)
            .limit(limit),
        (row) => toCustomView(mapView(row)),
      );
    },
  },
  CustomView: {
    team: async (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) =>
      toTeam(await findTeam(v.teamId, ctx.user.id)),
    creator: (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) =>
      userById(v.creatorUserId, ctx.user.id),
    owner: (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) =>
      userById(v.ownerUserId ?? v.creatorUserId, ctx.user.id),
    updatedBy: (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) =>
      userById(v.updatedByUserId, ctx.user.id),
    organization: () => getOrganization(),
    // The view's issues: its filter within its team.
    issues: (
      v: GraphQLCustomView,
      args: PageArgs & { filter?: unknown; includeArchived?: boolean | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () =>
        listIssues(
          and(eq(issue.teamId, v.teamId), issueFilterSql(v.filterData, ctx.user.id)),
          args,
          ctx.user.id,
        ),
      ),
    viewPreferencesValues: (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) =>
      viewPreferencesValues(v.id, ctx.user.id),
    organizationViewPreferences: async (v: GraphQLCustomView) => {
      const row = await viewPreferencesFor(v.id, 'organization');
      return row ? toViewPreferences(row) : null;
    },
    userViewPreferences: async (v: GraphQLCustomView, _: unknown, ctx: GraphQLContext) => {
      const row = await viewPreferencesFor(v.id, 'user', ctx.user.id);
      return row ? toViewPreferences(row) : null;
    },
  },
  Mutation: {
    customViewCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        checkViewInput(
          input,
          [
            'name',
            'description',
            'icon',
            'color',
            'teamId',
            'filterData',
            'shared',
            'ownerId',
            'id',
            ...UNSUPPORTED_VIEW_FIELDS,
          ],
          ctx,
        );
        if (!input.teamId) throw gqlError('INVALID_INPUT', 'input.teamId is required');
        const team = await findTeam(String(input.teamId), ctx.user.id);
        const created = await createView(
          team.id,
          {
            name: String(input.name ?? ''),
            description: (input.description as string | null) ?? null,
            icon: (input.icon as string | null) ?? null,
            color: (input.color as string | null) ?? null,
            filterData: plainJson(input.filterData) ?? {},
            shared: (input.shared as boolean | undefined) ?? true,
            ownerUserId: (input.ownerId as string | undefined) ?? undefined,
            id: (input.id as string | undefined) ?? undefined,
          },
          ctx.user.id,
        );
        return viewPayload(created);
      }),
    customViewUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        checkViewInput(
          input,
          [
            'name',
            'description',
            'icon',
            'color',
            'teamId',
            'filterData',
            'shared',
            'ownerId',
            ...UNSUPPORTED_VIEW_FIELDS,
          ],
          ctx,
        );
        const found = await findView(id, ctx);
        if (input.teamId === null) throw gqlError('INVALID_INPUT', 'A view needs a team');
        const teamId = input.teamId
          ? (await findTeam(String(input.teamId), ctx.user.id)).id
          : undefined;
        const updated = await updateView(
          found.id,
          {
            name: input.name as string | undefined,
            description: input.description as string | null | undefined,
            icon: input.icon as string | null | undefined,
            color: input.color as string | null | undefined,
            filterData: plainJson(input.filterData),
            shared: input.shared as boolean | undefined,
            ownerUserId: input.ownerId as string | undefined,
            teamId,
          },
          ctx.user.id,
        );
        return viewPayload(updated!);
      }),
    customViewDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findView(id, ctx);
        await deleteView(found.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),
    viewPreferencesCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          ['type', 'viewType', 'customViewId', 'preferences', 'userId', 'id'],
          'input',
        );
        if (input.type === 'user' && input.userId && input.userId !== ctx.user.id)
          throw gqlError('INVALID_INPUT', "input.userId must be the viewer's own id");
        if (input.viewType !== 'customView' || !input.customViewId) {
          // A user's own preferences for a list kind, without a saved view.
          const viewType = listViewType(input.viewType, 'input.viewType');
          if (input.customViewId || input.type !== 'user')
            throw gqlError(
              'INVALID_INPUT',
              `Preferences for ${viewType} are personal: type user without customViewId`,
            );
          const row = await upsertListPreferences({
            userId: ctx.user.id,
            viewType,
            preferences: (plainJson(input.preferences) ?? {}) as Record<string, unknown>,
            id: (input.id as string | undefined) ?? undefined,
          });
          return prefsPayload(row);
        }
        const view = await findView(String(input.customViewId), ctx);
        const row = await upsertViewPreferences({
          customViewId: view.id,
          type: input.type as 'organization' | 'user',
          userId: input.type === 'user' ? ctx.user.id : null,
          preferences: (plainJson(input.preferences) ?? {}) as Record<string, unknown>,
          id: (input.id as string | undefined) ?? undefined,
        });
        return prefsPayload(row);
      }),
    viewPreferencesUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['preferences'], 'input');
        const found = await findViewPreferences(id, ctx);
        const row = await updateViewPreferences(
          found.id,
          (plainJson(input.preferences) ?? found.preferences) as Record<string, unknown>,
        );
        return prefsPayload(row!);
      }),
    viewPreferencesDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await findViewPreferences(id, ctx);
        await deleteViewPreferences(found.id);
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),
  },
};

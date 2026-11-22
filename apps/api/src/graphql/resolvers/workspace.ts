import { db, team, teamMember, workspaceInvite } from '@repo/db';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { getInvite, inviteToWorkspace, revokeInvite, type InviteRole } from '../../invites/store';
import { addTeamMember, removeTeamMember } from '../../members/store';
import { assertAllowedTo } from '../../organization/store';
import {
  assertTeamAccess,
  assertWorkspaceRole,
  visibleTeamIds,
  type WorkspaceRole,
} from '../../shared/access';
import { HttpError, UUID_RE, rethrowDuplicate } from '../../shared/lib';
import { createTeam, getTeamById, getTeamByKey } from '../../teams/store';
import { changeWorkspaceRole, suspendUser, unsuspendUser } from '../../workspace/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { gqlError } from '../errors';
import { filterSql } from '../filter';
import { userById } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { getOrganization } from './organization';
import { findTeam, teamFilter, toTeam } from './team';

// Linear's workspace administration over GraphQL: team memberships, role changes and
// suspension, organization invites and teamCreate. The rules are the stores' (the
// same as REST); this module maps Linear's shapes onto them.

type MembershipRow = typeof teamMember.$inferSelect;
type InviteTableRow = typeof workspaceInvite.$inferSelect;
type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

// Linear names a workspace member `user`; app users arrive with agents.
const ROLE_FROM_LINEAR: Record<string, WorkspaceRole> = {
  owner: 'owner',
  admin: 'admin',
  user: 'member',
  guest: 'guest',
};
const linearRole = (role: string) => (role === 'member' ? 'user' : role);

function roleInput(value: unknown, allowed: WorkspaceRole[]): WorkspaceRole {
  const role = ROLE_FROM_LINEAR[String(value)];
  if (!role || !allowed.includes(role))
    throw gqlError('INVALID_INPUT', `Role ${value} is not supported`);
  return role;
}

const toMembership = (row: MembershipRow) => ({
  id: row.id,
  owner: row.owner,
  teamId: row.teamId,
  userId: row.userId,
  sortOrder: 0,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.createdAt.toISOString(),
  archivedAt: null,
});
type GraphQLMembership = ReturnType<typeof toMembership>;

// Memberships in teams the viewer can see, newest first.
function listMemberships(
  where: ReturnType<typeof eq> | undefined,
  args: ConnectionArgs,
  viewerId: string,
) {
  return paginate(
    args,
    { id: teamMember.id, createdAt: teamMember.createdAt, updatedAt: teamMember.createdAt },
    and(inArray(teamMember.teamId, visibleTeamIds(viewerId)), where),
    (w, order, limit) =>
      db
        .select()
        .from(teamMember)
        .where(w)
        .orderBy(...order)
        .limit(limit)
        .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
    (row) => toMembership(row),
  );
}

async function findMembership(id: string, viewerId: string): Promise<MembershipRow> {
  const [row] = UUID_RE.test(id)
    ? await db
        .select()
        .from(teamMember)
        .where(and(eq(teamMember.id, id), inArray(teamMember.teamId, visibleTeamIds(viewerId))))
    : [];
  if (!row) throw gqlError('ENTITY_NOT_FOUND', `Team membership ${id} not found`);
  return row;
}

const toInvite = (row: {
  id: string;
  email: string;
  role: string;
  invitedByUserId: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
}) => ({
  id: row.id,
  email: row.email,
  role: linearRole(row.role),
  inviterId: row.invitedByUserId,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.createdAt).toISOString(),
  expiresAt: new Date(row.expiresAt).toISOString(),
  acceptedAt: null,
  archivedAt: null,
  external: false,
  metadata: null,
});
type GraphQLInvite = ReturnType<typeof toInvite>;

// A team key from its name when the client leaves it out (Linear generates one):
// the name's letters and digits, uppercased, starting with a letter, at most 5.
function keyFromName(name: string): string {
  const key = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^[0-9]+/, '')
    .slice(0, 5);
  if (!key) throw gqlError('INVALID_INPUT', 'input.key is required for this name');
  return key;
}

const uuidArg = (id: string, what: string) => {
  if (!UUID_RE.test(id)) throw gqlError('INVALID_INPUT', `${what} is not a valid id`);
  return id;
};

// The team a membership is created in: one the viewer can see, or, for a workspace
// admin or owner, a private team they are not in yet (they may add themselves).
async function teamToJoin(idOrKey: string, ctx: GraphQLContext) {
  const found = UUID_RE.test(idOrKey) ? await getTeamById(idOrKey) : await getTeamByKey(idOrKey);
  if (!found) throw gqlError('ENTITY_NOT_FOUND', `Team ${idOrKey} not found`);
  await assertTeamAccess(found.id, ctx.user, 'join', `Team ${idOrKey} not found`);
  return found;
}

export const workspaceResolvers = {
  Query: {
    teamMembership: async (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      toMembership(await findMembership(id, ctx.user.id)),
    teamMemberships: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listMemberships(undefined, args, ctx.user.id),
    organizationInvites: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      guard(async () => {
        await assertWorkspaceRole(ctx.user, 'member');
        return paginate(
          args,
          {
            id: workspaceInvite.id,
            createdAt: workspaceInvite.createdAt,
            updatedAt: workspaceInvite.createdAt,
          },
          gt(workspaceInvite.expiresAt, sql`now()`),
          (w, order, limit) =>
            db
              .select()
              .from(workspaceInvite)
              .where(w)
              .orderBy(...order)
              .limit(limit)
              .then((rows: InviteTableRow[]) =>
                rows.map((r) => ({ ...r, updatedAt: r.createdAt })),
              ),
          (row) => toInvite(row),
        );
      }),
    organizationInvite: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await assertWorkspaceRole(ctx.user, 'member');
        const found = UUID_RE.test(id) ? await getInvite(id) : null;
        if (!found) throw gqlError('ENTITY_NOT_FOUND', `Organization invite ${id} not found`);
        return toInvite(found);
      }),
  },
  Team: {
    memberships: (t: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listMemberships(eq(teamMember.teamId, t.id), args, ctx.user.id),
  },
  User: {
    teamMemberships: (u: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listMemberships(eq(teamMember.userId, u.id), args, ctx.user.id),
    teams: (u: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      paginate(
        args,
        { id: team.id, createdAt: team.createdAt, updatedAt: team.createdAt },
        and(
          inArray(team.id, visibleTeamIds(ctx.user.id)),
          inArray(
            team.id,
            db
              .select({ id: teamMember.teamId })
              .from(teamMember)
              .where(eq(teamMember.userId, u.id)),
          ),
          filterSql(args.filter, teamFilter),
        ),
        (w, order, limit) =>
          db
            .select()
            .from(team)
            .where(w)
            .orderBy(...order)
            .limit(limit)
            .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
        (row) => toTeam(row),
      ),
  },
  Organization: {
    teams: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      paginate(
        args,
        { id: team.id, createdAt: team.createdAt, updatedAt: team.createdAt },
        and(inArray(team.id, visibleTeamIds(ctx.user.id)), filterSql(args.filter, teamFilter)),
        (w, order, limit) =>
          db
            .select()
            .from(team)
            .where(w)
            .orderBy(...order)
            .limit(limit)
            .then((rows) => rows.map((r) => ({ ...r, updatedAt: r.createdAt }))),
        (row) => toTeam(row),
      ),
  },
  TeamMembership: {
    team: async (m: GraphQLMembership, _: unknown, ctx: GraphQLContext) =>
      toTeam(await findTeam(m.teamId, ctx.user.id)),
    user: (m: GraphQLMembership, _: unknown, ctx: GraphQLContext) =>
      userById(m.userId, ctx.user.id),
  },
  OrganizationInvite: {
    inviter: (i: GraphQLInvite, _: unknown, ctx: GraphQLContext) =>
      userById(i.inviterId, ctx.user.id),
    invitee: () => null,
    organization: () => getOrganization(),
  },
  Mutation: {
    teamCreate: (
      _: unknown,
      {
        input,
        copySettingsFromTeamId,
      }: { input: Record<string, unknown>; copySettingsFromTeamId?: string | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'key', 'description'], 'input');
        if (copySettingsFromTeamId != null)
          throw gqlError('INVALID_INPUT', 'copySettingsFromTeamId is not supported');
        const actor = await assertAllowedTo(ctx.user, 'teamCreation');
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name) throw gqlError('INVALID_INPUT', 'input.name must be a non-empty string');
        const key = input.key == null ? keyFromName(name) : String(input.key);
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key))
          throw gqlError(
            'INVALID_INPUT',
            'input.key must be letters and digits, starting with a letter',
          );
        const created = await createTeam(
          {
            key,
            name,
            description: typeof input.description === 'string' ? input.description : undefined,
          },
          actor.id,
        ).catch((err) => rethrowDuplicate(err, 'team key'));
        const [row] = await db.select().from(team).where(eq(team.id, created.id));
        return { success: true, lastSyncId: lastSyncId(), team: toTeam(row!) };
      }),
    teamMembershipCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['teamId', 'userId'], 'input');
        const found = await teamToJoin(String(input.teamId), ctx);
        const userId = uuidArg(String(input.userId), 'input.userId');
        await addTeamMember(found, userId, false, ctx.user);
        const [row] = await db
          .select()
          .from(teamMember)
          .where(and(eq(teamMember.teamId, found.id), eq(teamMember.userId, userId)));
        return { success: true, lastSyncId: lastSyncId(), teamMembership: toMembership(row!) };
      }),
    // Linear's update input holds only sortOrder, which this instance does not keep.
    teamMembershipUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, [], 'input');
        return {
          success: true,
          lastSyncId: lastSyncId(),
          teamMembership: toMembership(await findMembership(id, ctx.user.id)),
        };
      }),
    teamMembershipDelete: (
      _: unknown,
      { id, alsoLeaveParentTeams }: { id: string; alsoLeaveParentTeams?: boolean | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        if (alsoLeaveParentTeams)
          throw gqlError('INVALID_INPUT', 'alsoLeaveParentTeams is not supported');
        const found = await findMembership(id, ctx.user.id);
        await removeTeamMember(found.teamId, found.userId, ctx.user);
        return { success: true, lastSyncId: lastSyncId(), entityId: found.id };
      }),
    userChangeRole: (_: unknown, { id, role }: { id: string; role: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const next = roleInput(role, ['owner', 'admin', 'member', 'guest']);
        await changeWorkspaceRole(uuidArg(id, 'id'), next, ctx.user.id);
        return { success: true };
      }),
    userSuspend: (
      _: unknown,
      {
        id,
        forceBypassScimRestrictions,
      }: { id: string; forceBypassScimRestrictions?: boolean | null },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        if (forceBypassScimRestrictions)
          throw gqlError('INVALID_INPUT', 'forceBypassScimRestrictions is not supported');
        await suspendUser(uuidArg(id, 'id'), ctx.user.id);
        return { success: true };
      }),
    userUnsuspend: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        await unsuspendUser(uuidArg(id, 'id'), ctx.user.id);
        return { success: true };
      }),
    organizationInviteCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['email', 'role', 'teamIds'], 'input');
        const role = roleInput(input.role ?? 'user', ['admin', 'member', 'guest']) as InviteRole;
        const teamIds = (input.teamIds as string[] | null | undefined) ?? [];
        for (const teamId of teamIds) uuidArg(teamId, 'input.teamIds');
        if (typeof input.email !== 'string' || !input.email.includes('@'))
          throw gqlError('INVALID_INPUT', 'input.email must be an email address');
        const created = await inviteToWorkspace({ email: input.email, role, teamIds }, ctx.user);
        return { success: true, lastSyncId: lastSyncId(), organizationInvite: toInvite(created) };
      }),
    organizationInviteDelete: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        if (!UUID_RE.test(id)) throw new HttpError(404, 'Invite not found');
        await revokeInvite(id, ctx.user);
        return { success: true, lastSyncId: lastSyncId(), entityId: id };
      }),
  },
};

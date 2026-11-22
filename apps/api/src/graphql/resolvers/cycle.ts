import { cycle, db, issue, team, teamMember } from '@repo/db';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import {
  activeCycle,
  archiveCycle,
  createCycle,
  cycleProgress,
  getCycle,
  mapCycle,
  setTeamCycleSettings,
  updateCycle,
  type CycleRow,
} from '../../cycles/store';
import { getMembership } from '../../members/store';
import { assertPermission } from '../../shared/access';
import { HttpError, UUID_RE } from '../../shared/lib';
import { updateTeam } from '../../teams/store';
import type { GraphQLContext } from '../context';
import { paginate, type PageArgs } from '../connection';
import { cycleFilterSql } from '../cycle-filter';
import { gqlError } from '../errors';
import { listIssues } from './issue';
import { guard, lastSyncId, onlySupported } from './mutations';
import { findTeam, toTeam } from './team';

// Linear's Cycle over the cycle table, the team cycle fields, and teamUpdate.
// Cycles are visible to members of their team; writes need work_items.<action>.

type GraphQLCycle = ReturnType<typeof toCycle>;
type ConnectionArgs = PageArgs & { filter?: unknown; includeArchived?: boolean | null };

function toCycle(row: CycleRow) {
  return { ...row, autoArchivedAt: null, inheritedFromId: null };
}

const memberTeams = (userId: string) =>
  db.select({ id: teamMember.teamId }).from(teamMember).where(eq(teamMember.userId, userId));

function listCycles(where: SQL | undefined, args: ConnectionArgs, ctx: GraphQLContext) {
  return paginate(
    args,
    { id: cycle.id, createdAt: cycle.createdAt, updatedAt: cycle.updatedAt },
    and(
      inArray(cycle.teamId, memberTeams(ctx.user.id)),
      where,
      args.includeArchived ? undefined : isNull(cycle.archivedAt),
      cycleFilterSql(args.filter),
    ),
    (w, order, limit) =>
      db
        .select()
        .from(cycle)
        .where(w)
        .orderBy(...order)
        .limit(limit),
    (row) => toCycle(mapCycle(row)),
  );
}

// A cycle the viewer can see, or ENTITY_NOT_FOUND.
async function visibleCycle(id: string, ctx: GraphQLContext): Promise<CycleRow> {
  const found = UUID_RE.test(id) ? await getCycle(id) : null;
  if (!found || !(await getMembership(found.teamId, ctx.user.id)))
    throw gqlError('ENTITY_NOT_FOUND', `Cycle ${id} not found`);
  return found;
}

const isActiveAt = (c: GraphQLCycle, now: number) =>
  !c.completedAt && new Date(c.startsAt).getTime() <= now && new Date(c.endsAt).getTime() > now;

const dateInput = (v: unknown, path: string): Date | undefined => {
  if (v === undefined || v === null) return undefined;
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) throw gqlError('INVALID_INPUT', `${path} must be a date`);
  return d;
};

const cyclePayload = (row: CycleRow) => ({
  success: true,
  lastSyncId: lastSyncId(),
  cycle: toCycle(row),
});

const TEAM_CYCLE_FIELDS = {
  cyclesEnabled: 'enabled',
  cycleDuration: 'duration',
  cycleStartDay: 'startDay',
  cycleCooldownTime: 'cooldown',
  upcomingCycleCount: 'upcoming',
  cycleIssueAutoAssignStarted: 'autoAssignStarted',
  cycleIssueAutoAssignCompleted: 'autoAssignCompleted',
} as const;

export const cycleResolvers = {
  Query: {
    cycle: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => toCycle(await visibleCycle(id, ctx))),
    cycles: (_: unknown, args: ConnectionArgs, ctx: GraphQLContext) =>
      listCycles(undefined, args, ctx),
  },
  Team: {
    cycles: (t: { id: string }, args: ConnectionArgs, ctx: GraphQLContext) =>
      listCycles(eq(cycle.teamId, t.id), args, ctx),
    activeCycle: async (t: { id: string }) => {
      const found = await activeCycle(t.id, new Date());
      return found ? toCycle(found) : null;
    },
  },
  Issue: {
    cycle: async (i: { cycleId: string | null }) => {
      if (!i.cycleId) return null;
      const found = await getCycle(i.cycleId);
      return found ? toCycle(found) : null;
    },
  },
  Cycle: {
    team: async (c: GraphQLCycle) => {
      const [row] = await db.select().from(team).where(eq(team.id, c.teamId));
      return row ? toTeam(row) : null;
    },
    issues: (c: GraphQLCycle, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(eq(issue.cycleId, c.id), args, ctx.user.id),
    uncompletedIssuesUponClose: (c: GraphQLCycle, args: ConnectionArgs, ctx: GraphQLContext) =>
      listIssues(
        inArray(
          issue.id,
          c.uncompletedIssueIdsUponClose.length ? c.uncompletedIssueIdsUponClose : [c.id],
        ),
        { ...args, includeArchived: true },
        ctx.user.id,
      ),
    progress: async (c: GraphQLCycle) => (await cycleProgress(c.id)).progress,
    isActive: (c: GraphQLCycle) => isActiveAt(c, Date.now()),
    isFuture: (c: GraphQLCycle) => new Date(c.startsAt).getTime() > Date.now(),
    isPast: (c: GraphQLCycle) => new Date(c.endsAt).getTime() <= Date.now(),
    isNext: async (c: GraphQLCycle) => {
      const [row] = await db
        .select({ id: cycle.id })
        .from(cycle)
        .where(
          and(eq(cycle.teamId, c.teamId), isNull(cycle.archivedAt), gt(cycle.startsAt, new Date())),
        )
        .orderBy(asc(cycle.startsAt))
        .limit(1);
      return row?.id === c.id;
    },
    isPrevious: async (c: GraphQLCycle) => {
      const [row] = await db
        .select({ id: cycle.id })
        .from(cycle)
        .where(and(eq(cycle.teamId, c.teamId), isNotNull(cycle.completedAt)))
        .orderBy(desc(cycle.completedAt))
        .limit(1);
      return row?.id === c.id;
    },
  },
  Mutation: {
    cycleCreate: (
      _: unknown,
      { input }: { input: Record<string, unknown> & { teamId: string } },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(
          input,
          ['teamId', 'startsAt', 'endsAt', 'name', 'description', 'id'],
          'input',
        );
        const found = await findTeam(input.teamId, ctx.user.id);
        await assertPermission(found.id, ctx.user, 'work_items', 'create');
        const startsAt = dateInput(input.startsAt, 'input.startsAt');
        const endsAt = dateInput(input.endsAt, 'input.endsAt');
        if (!startsAt || !endsAt)
          throw gqlError('INVALID_INPUT', 'input.startsAt and input.endsAt are required');
        if (input.id && !UUID_RE.test(input.id as string))
          throw gqlError('INVALID_INPUT', 'input.id is not a valid id');
        const created = await createCycle(
          found.id,
          {
            startsAt,
            endsAt,
            name: input.name as string | undefined,
            description: input.description as string | undefined,
            id: input.id as string | undefined,
          },
          ctx.user.id,
        );
        return cyclePayload(created);
      }),
    cycleUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'description', 'startsAt', 'endsAt', 'completedAt'], 'input');
        const found = await visibleCycle(id, ctx);
        await assertPermission(found.teamId, ctx.user, 'work_items', 'edit');
        const updated = await updateCycle(
          id,
          {
            name: input.name as string | null | undefined,
            description: input.description as string | null | undefined,
            startsAt: dateInput(input.startsAt, 'input.startsAt'),
            endsAt: dateInput(input.endsAt, 'input.endsAt'),
            completedAt: dateInput(input.completedAt, 'input.completedAt'),
          },
          ctx.user.id,
          new Date(),
        );
        return cyclePayload(updated);
      }),
    cycleArchive: (_: unknown, { id }: { id: string }, ctx: GraphQLContext) =>
      guard(async () => {
        const found = await visibleCycle(id, ctx);
        await assertPermission(found.teamId, ctx.user, 'work_items', 'delete');
        const archived = await archiveCycle(id, ctx.user.id, new Date());
        return { success: true, lastSyncId: lastSyncId(), entity: toCycle(archived) };
      }),
    // Name, description and the cycle settings; team owner only (the REST rule).
    teamUpdate: (
      _: unknown,
      { id, input }: { id: string; input: Record<string, unknown> },
      ctx: GraphQLContext,
    ) =>
      guard(async () => {
        onlySupported(input, ['name', 'description', ...Object.keys(TEAM_CYCLE_FIELDS)], 'input');
        const found = await findTeam(id, ctx.user.id);
        if ((await getMembership(found.id, ctx.user.id)) !== 'owner')
          throw new HttpError(403, 'Only a team owner can change team settings');
        if (input.name !== undefined || input.description !== undefined)
          await updateTeam(found.id, {
            name: input.name as string | undefined,
            description: input.description as string | undefined,
          });
        const settings: Record<string, unknown> = {};
        for (const [field, key] of Object.entries(TEAM_CYCLE_FIELDS))
          if (input[field] !== undefined && input[field] !== null) settings[key] = input[field];
        if (Object.keys(settings).length) await setTeamCycleSettings(found.id, settings);
        const [row] = await db.select().from(team).where(eq(team.id, found.id));
        return { success: true, lastSyncId: lastSyncId(), team: toTeam(row!) };
      }),
  },
};

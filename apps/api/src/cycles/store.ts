import { cycle, db, team } from '@repo/db';
import { and, asc, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { currentCycleStart, cycleEnd, nextCycleStart, type CycleSettings } from './schedule';

// Team cycles (Linear's Cycle). A team with cycles enabled always has a current
// cycle and `upcoming` cycles ahead; cycles never overlap. Upkeep (closing,
// rollover, history) is in this module too and runs from the worker's hourly call.

export interface CycleRow {
  id: string;
  teamId: string;
  number: number;
  name: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  issueCountHistory: number[];
  completedIssueCountHistory: number[];
  scopeHistory: number[];
  completedScopeHistory: number[];
  inProgressScopeHistory: number[];
  uncompletedIssueIdsUponClose: string[];
  createdAt: string;
  updatedAt: string;
}

export function mapCycle(row: typeof cycle.$inferSelect): CycleRow {
  return {
    id: row.id,
    teamId: row.teamId,
    number: row.number,
    name: row.name,
    description: row.description,
    startsAt: iso(row.startsAt),
    endsAt: iso(row.endsAt),
    completedAt: row.completedAt ? iso(row.completedAt) : null,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    issueCountHistory: row.issueCountHistory,
    completedIssueCountHistory: row.completedIssueCountHistory,
    scopeHistory: row.scopeHistory,
    completedScopeHistory: row.completedScopeHistory,
    inProgressScopeHistory: row.inProgressScopeHistory,
    uncompletedIssueIdsUponClose: row.uncompletedIssueIdsUponClose,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function sendCycleEvent(
  action: WebhookAction,
  c: CycleRow,
  actorUserId: string | null,
  before?: CycleRow,
): Promise<void> {
  await emitEvent({
    type: 'Cycle',
    action,
    teamIds: [c.teamId],
    actorUserId,
    data: { ...c },
    before: before ? { ...before } : undefined,
  });
}

export async function getCycle(id: string): Promise<CycleRow | null> {
  const [row] = await db.select().from(cycle).where(eq(cycle.id, id));
  return row ? mapCycle(row) : null;
}

// The team's cycles in start order; archived ones only when asked.
export async function listCycles(
  teamId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<CycleRow[]> {
  const rows = await db
    .select()
    .from(cycle)
    .where(
      and(eq(cycle.teamId, teamId), opts.includeArchived ? undefined : isNull(cycle.archivedAt)),
    )
    .orderBy(asc(cycle.startsAt));
  return rows.map(mapCycle);
}

// --- Team settings ---------------------------------------------------------------

export interface TeamCycleSettings extends CycleSettings {
  enabled: boolean;
  autoAssignStarted: boolean;
  autoAssignCompleted: boolean;
}

export async function teamCycleSettings(teamId: string): Promise<TeamCycleSettings> {
  const [row] = await db.select().from(team).where(eq(team.id, teamId));
  if (!row) throw new HttpError(404, 'Team not found');
  return {
    enabled: row.cyclesEnabled,
    duration: row.cycleDuration,
    startDay: row.cycleStartDay,
    cooldown: row.cycleCooldownTime,
    upcoming: row.upcomingCycleCount,
    autoAssignStarted: row.cycleIssueAutoAssignStarted,
    autoAssignCompleted: row.cycleIssueAutoAssignCompleted,
  };
}

const RANGES: Record<'duration' | 'startDay' | 'cooldown' | 'upcoming', [number, number]> = {
  duration: [1, 8],
  startDay: [0, 6],
  cooldown: [0, 3],
  upcoming: [1, 10],
};

// Updates the given settings (400 for a value out of range). Turning cycles on
// creates the current and upcoming cycles; turning them off stops upkeep and leaves
// existing cycles as they are.
export async function setTeamCycleSettings(
  teamId: string,
  patch: Partial<TeamCycleSettings>,
): Promise<TeamCycleSettings> {
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const v = patch[key as keyof typeof RANGES];
    if (v !== undefined && !(Number.isInteger(v) && v >= min && v <= max))
      throw new HttpError(400, `cycles.${key} must be an integer from ${min} to ${max}`);
  }
  const before = await teamCycleSettings(teamId);
  const set: Partial<typeof team.$inferInsert> = {};
  if (patch.enabled !== undefined) set.cyclesEnabled = patch.enabled;
  if (patch.duration !== undefined) set.cycleDuration = patch.duration;
  if (patch.startDay !== undefined) set.cycleStartDay = patch.startDay;
  if (patch.cooldown !== undefined) set.cycleCooldownTime = patch.cooldown;
  if (patch.upcoming !== undefined) set.upcomingCycleCount = patch.upcoming;
  if (patch.autoAssignStarted !== undefined)
    set.cycleIssueAutoAssignStarted = patch.autoAssignStarted;
  if (patch.autoAssignCompleted !== undefined)
    set.cycleIssueAutoAssignCompleted = patch.autoAssignCompleted;
  if (Object.keys(set).length) await db.update(team).set(set).where(eq(team.id, teamId));
  const after = await teamCycleSettings(teamId);
  if (after.enabled && !before.enabled) await ensureCycles(teamId, new Date());
  return after;
}

// --- Creating cycles -------------------------------------------------------------

// Inserts a cycle with the team's next number (under a row lock on the team) and
// sends the Cycle create webhook. 400 when it overlaps a non-archived cycle.
async function insertCycle(
  teamId: string,
  input: {
    startsAt: Date;
    endsAt: Date;
    name?: string | null;
    description?: string | null;
    id?: string;
  },
  actorUserId: string | null,
): Promise<CycleRow> {
  if (!(input.endsAt > input.startsAt)) throw new HttpError(400, 'endsAt must be after startsAt');
  const row = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ next: team.nextCycleNumber })
      .from(team)
      .where(eq(team.id, teamId))
      .for('update');
    if (!locked) throw new HttpError(404, 'Team not found');
    const [overlap] = await tx
      .select({ id: cycle.id })
      .from(cycle)
      .where(
        and(
          eq(cycle.teamId, teamId),
          isNull(cycle.archivedAt),
          lt(cycle.startsAt, input.endsAt),
          gt(cycle.endsAt, input.startsAt),
        ),
      )
      .limit(1);
    if (overlap) throw new HttpError(400, 'The cycle overlaps another cycle of the team');
    await tx
      .update(team)
      .set({ nextCycleNumber: sql`next_cycle_number + 1` })
      .where(eq(team.id, teamId));
    const [created] = await tx
      .insert(cycle)
      .values({
        ...(input.id ? { id: input.id } : {}),
        teamId,
        number: locked.next,
        name: input.name ?? null,
        description: input.description ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      })
      .returning();
    return created!;
  });
  const created = mapCycle(row);
  await sendCycleEvent('create', created, actorUserId);
  return created;
}

// A hand-made cycle. 400 while cycles are off for the team or on an overlap.
export async function createCycle(
  teamId: string,
  input: {
    startsAt: Date;
    endsAt: Date;
    name?: string | null;
    description?: string | null;
    id?: string;
  },
  actorUserId: string | null,
): Promise<CycleRow> {
  if (!(await teamCycleSettings(teamId)).enabled)
    throw new HttpError(400, 'Cycles are not enabled for this team');
  return insertCycle(teamId, input, actorUserId);
}

// The team's cycle that contains `now` and is not completed or archived.
export async function activeCycle(teamId: string, now: Date): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(cycle)
    .where(
      and(
        eq(cycle.teamId, teamId),
        isNull(cycle.archivedAt),
        isNull(cycle.completedAt),
        lte(cycle.startsAt, now),
        gt(cycle.endsAt, now),
      ),
    );
  return row ? mapCycle(row) : null;
}

// Makes sure a cycle contains `now`: when none does, creates one starting on the
// most recent start day — or after the latest cycle, when that would overlap it.
// Past cycles are never backfilled.
export async function ensureCurrentCycle(teamId: string, now: Date): Promise<void> {
  const settings = await teamCycleSettings(teamId);
  const cycles = await listCycles(teamId);
  if (cycles.some((c) => new Date(c.startsAt) <= now && new Date(c.endsAt) > now)) return;
  let start = currentCycleStart(settings, now);
  const latest = cycles[cycles.length - 1];
  if (latest && new Date(latest.endsAt) > start)
    start = nextCycleStart(new Date(latest.endsAt), settings);
  if (start > now) return;
  await insertCycle(teamId, { startsAt: start, endsAt: cycleEnd(start, settings) }, null);
}

// Creates cycles after the latest one until `upcoming` start after `now`.
export async function ensureUpcomingCycles(teamId: string, now: Date): Promise<void> {
  const settings = await teamCycleSettings(teamId);
  const cycles = await listCycles(teamId);
  let ahead = cycles.filter((c) => new Date(c.startsAt) > now).length;
  let last = cycles[cycles.length - 1];
  while (ahead < settings.upcoming) {
    const start = last
      ? nextCycleStart(new Date(last.endsAt), settings)
      : currentCycleStart(settings, now);
    last = await insertCycle(teamId, { startsAt: start, endsAt: cycleEnd(start, settings) }, null);
    if (start > now) ahead += 1;
  }
}

export async function ensureCycles(teamId: string, now: Date): Promise<void> {
  await ensureCurrentCycle(teamId, now);
  await ensureUpcomingCycles(teamId, now);
}

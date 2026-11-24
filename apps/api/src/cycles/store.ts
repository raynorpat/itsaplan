import { withoutWorkflows } from '../shared/workflow-context';
import { weighProgress, type Progress } from '../shared/progress';
import { cycle, db, issue, team, workflowState } from '@repo/db';
import { and, asc, eq, gt, isNull, lt, lte, notInArray, sql } from 'drizzle-orm';
import { HttpError, iso } from '../shared/lib';
import { emitEvent, type WebhookAction } from '../webhooks/event';
import { updateIssue } from '../issues/store';
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

// Linear's Cycle as webhook data (CycleWebhookPayload field names).
function cycleWebhookData(c: CycleRow): Record<string, unknown> {
  const { uncompletedIssueIdsUponClose, ...rest } = c;
  return {
    ...rest,
    uncompletedIssuesUponCloseIds: uncompletedIssueIdsUponClose,
    autoArchivedAt: null,
    inheritedFromId: null,
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
    data: cycleWebhookData(c),
    before: before ? cycleWebhookData(before) : undefined,
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
// 400 for a setting out of its range.
export function validateCycleSettings(patch: Partial<TeamCycleSettings>): void {
  for (const [key, [min, max]] of Object.entries(RANGES)) {
    const v = patch[key as keyof typeof RANGES];
    if (v !== undefined && !(Number.isInteger(v) && v >= min && v <= max))
      throw new HttpError(400, `cycles.${key} must be an integer from ${min} to ${max}`);
  }
}

export async function setTeamCycleSettings(
  teamId: string,
  patch: Partial<TeamCycleSettings>,
): Promise<TeamCycleSettings> {
  validateCycleSettings(patch);
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

type Executor = Pick<typeof db, 'select'>;

// 400 when [startsAt, endsAt) overlaps a non-archived cycle of the team other than
// `exceptId`.
async function assertNoOverlap(
  executor: Executor,
  teamId: string,
  startsAt: Date,
  endsAt: Date,
  exceptId?: string,
): Promise<void> {
  const [overlap] = await executor
    .select({ id: cycle.id })
    .from(cycle)
    .where(
      and(
        eq(cycle.teamId, teamId),
        isNull(cycle.archivedAt),
        lt(cycle.startsAt, endsAt),
        gt(cycle.endsAt, startsAt),
        exceptId ? sql`${cycle.id} <> ${exceptId}` : undefined,
      ),
    )
    .limit(1);
  if (overlap) throw new HttpError(400, 'The cycle overlaps another cycle of the team');
}

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
    await assertNoOverlap(tx, teamId, input.startsAt, input.endsAt);
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

// --- Progress -------------------------------------------------------------------

export type CycleProgress = Progress;

// Linear's cycle progress (shared/progress.ts) over the cycle's issues.
export async function cycleProgress(cycleId: string): Promise<CycleProgress> {
  const rows = await db
    .select({ estimate: issue.estimate, type: workflowState.stateType })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(eq(issue.cycleId, cycleId));
  return weighProgress(rows);
}

// --- Upkeep ---------------------------------------------------------------------

// The team's cycle containing `at` (not archived), or null.
async function cycleContaining(teamId: string, at: Date): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(cycle)
    .where(
      and(
        eq(cycle.teamId, teamId),
        isNull(cycle.archivedAt),
        lte(cycle.startsAt, at),
        gt(cycle.endsAt, at),
      ),
    );
  return row ? mapCycle(row) : null;
}

// The team's earliest non-archived cycle starting after `now`, or null.
async function nextUpcomingCycle(teamId: string, now: Date): Promise<CycleRow | null> {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.teamId, teamId), isNull(cycle.archivedAt), gt(cycle.startsAt, now)))
    .orderBy(asc(cycle.startsAt))
    .limit(1);
  return row ? mapCycle(row) : null;
}

// Closes a cycle at `closedAt` (its end, or earlier when closed by hand): records
// its unfinished issues (not completed or canceled, not archived) and moves them to
// the team's cycle containing `now` — or, after an early close, the next upcoming
// cycle — through updateIssue so the move is logged and sent as Issue webhooks.
// Sends the Cycle update webhook.
export async function closeCycle(
  cycleId: string,
  closedAt: Date,
  now: Date,
  actorUserId: string | null,
): Promise<CycleRow> {
  const before = await getCycle(cycleId);
  if (!before) throw new HttpError(404, 'Cycle not found');
  const unfinished = await db
    .select({ id: issue.id })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(
      and(
        eq(issue.cycleId, cycleId),
        isNull(issue.archivedAt),
        notInArray(workflowState.stateType, ['completed', 'canceled']),
      ),
    );
  const endsAt = new Date(before.endsAt) < closedAt ? new Date(before.endsAt) : closedAt;
  // Only an open cycle closes: a second close (a hand close racing upkeep) changes
  // nothing and keeps the first close's snapshot.
  const [row] = await db
    .update(cycle)
    .set({
      completedAt: closedAt,
      endsAt,
      uncompletedIssueIdsUponClose: unfinished.map((r) => r.id),
      updatedAt: new Date(),
    })
    .where(and(eq(cycle.id, cycleId), isNull(cycle.completedAt)))
    .returning();
  if (!row) return before;
  const closed = mapCycle(row!);
  const target =
    (await cycleContaining(closed.teamId, now)) ?? (await nextUpcomingCycle(closed.teamId, now));
  if (target && target.id !== cycleId)
    // Rollover is a system change: it runs no automation rules.
    for (const { id } of unfinished)
      await withoutWorkflows(() => updateIssue(id, { cycleId: target.id }, actorUserId));
  await sendCycleEvent('update', closed, actorUserId, before);
  return closed;
}

// Closes every cycle of the team whose end has passed and is not completed yet.
export async function closeEndedCycles(teamId: string, now: Date): Promise<void> {
  const ended = await db
    .select({ id: cycle.id, endsAt: cycle.endsAt })
    .from(cycle)
    .where(
      and(
        eq(cycle.teamId, teamId),
        isNull(cycle.archivedAt),
        isNull(cycle.completedAt),
        lte(cycle.endsAt, now),
      ),
    )
    .orderBy(asc(cycle.startsAt));
  for (const c of ended) await closeCycle(c.id, c.endsAt, now, null);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Appends today's progress values to each active cycle's history arrays, once per
// day since the cycle started; missed days are filled with the current values.
export async function recordHistory(teamId: string, now: Date): Promise<void> {
  const active = await activeCycle(teamId, now);
  if (!active) return;
  const days = Math.floor((now.getTime() - new Date(active.startsAt).getTime()) / DAY_MS) + 1;
  const missing = days - active.issueCountHistory.length;
  if (missing <= 0) return;
  const p = await cycleProgress(active.id);
  const fill = <T>(list: T[], value: T) => [...list, ...Array<T>(missing).fill(value)];
  await db
    .update(cycle)
    .set({
      issueCountHistory: fill(active.issueCountHistory, p.issueCount),
      completedIssueCountHistory: fill(active.completedIssueCountHistory, p.completedIssueCount),
      scopeHistory: fill(active.scopeHistory, p.scope),
      completedScopeHistory: fill(active.completedScopeHistory, p.completedScope),
      inProgressScopeHistory: fill(active.inProgressScopeHistory, p.inProgressScope),
    })
    .where(eq(cycle.id, active.id));
}

// The hourly upkeep for every team with cycles enabled, in order: a cycle contains
// now; upcoming cycles are created; ended cycles close with rollover into the
// current cycle (or the next one when none contains now); the active cycle's
// history is appended. Each step works from dates, so a missed run
// is caught up by the next one.
export async function runUpkeep(now: Date): Promise<void> {
  const teams = await db.select({ id: team.id }).from(team).where(eq(team.cyclesEnabled, true));
  for (const { id } of teams) {
    // One team's failure must not stop upkeep for the others; the next run retries.
    try {
      await ensureCurrentCycle(id, now);
      await ensureUpcomingCycles(id, now);
      await closeEndedCycles(id, now);
      await recordHistory(id, now);
    } catch (err) {
      console.error(`[cycles] upkeep failed for team ${id}:`, err);
    }
  }
}

// --- Issues and cycles -----------------------------------------------------------

// A cycle an issue of `teamId` may join: the team's own, not archived. 400 otherwise.
export async function assertCycleOfTeam(teamId: string, cycleId: string | null | undefined) {
  if (!cycleId) return;
  const found = await getCycle(cycleId);
  if (!found || found.teamId !== teamId || found.archivedAt)
    throw new HttpError(400, "The cycle must be an active or upcoming cycle of the issue's team");
}

// The cycle an issue gets from auto-assign, or undefined to leave it as it is: an
// issue with no cycle that is created in, or moves to, a started (or completed)
// state joins the active cycle when the team's matching setting is on. A cycleId
// given in the same write (including null) wins.
export async function autoAssignCycleId(
  teamId: string,
  stateType: string | null,
  current: string | null,
  explicit: string | null | undefined,
  now: Date,
): Promise<string | undefined> {
  if (explicit !== undefined || current || !stateType) return undefined;
  const settings = await teamCycleSettings(teamId);
  if (!settings.enabled) return undefined;
  const wanted =
    (stateType === 'started' && settings.autoAssignStarted) ||
    (stateType === 'completed' && settings.autoAssignCompleted);
  if (!wanted) return undefined;
  return (await activeCycle(teamId, now))?.id;
}

// Archives a completed or future cycle (400 for the active one). Archiving a future
// cycle takes its issues out of it. Sends the Cycle remove webhook.
export async function archiveCycle(id: string, actorUserId: string | null, now: Date) {
  const found = await getCycle(id);
  if (!found) throw new HttpError(404, 'Cycle not found');
  const isFuture = new Date(found.startsAt) > now;
  if (!found.completedAt && !isFuture)
    throw new HttpError(400, 'The active cycle cannot be archived');
  if (isFuture) {
    const members = await db.select({ id: issue.id }).from(issue).where(eq(issue.cycleId, id));
    for (const m of members)
      await withoutWorkflows(() => updateIssue(m.id, { cycleId: null }, actorUserId));
  }
  const [row] = await db
    .update(cycle)
    .set({ archivedAt: now, updatedAt: new Date() })
    .where(eq(cycle.id, id))
    .returning();
  const archived = mapCycle(row!);
  await sendCycleEvent('remove', archived, actorUserId);
  return archived;
}

// Changes a cycle's name, description or dates (400 on an overlap), or closes it
// by hand with completedAt: only the active cycle, not in the future; its end
// becomes completedAt and the close rolls over like a scheduled one.
export async function updateCycle(
  id: string,
  patch: {
    name?: string | null;
    description?: string | null;
    startsAt?: Date;
    endsAt?: Date;
    completedAt?: Date;
  },
  actorUserId: string | null,
  now: Date,
): Promise<CycleRow> {
  const before = await getCycle(id);
  if (!before) throw new HttpError(404, 'Cycle not found');
  if (patch.completedAt) {
    const isActive =
      !before.completedAt && new Date(before.startsAt) <= now && new Date(before.endsAt) > now;
    if (!isActive) throw new HttpError(400, 'Only the active cycle can be completed');
    if (patch.completedAt > now) throw new HttpError(400, 'completedAt cannot be in the future');
    if (patch.completedAt <= new Date(before.startsAt))
      throw new HttpError(400, 'completedAt must be after the cycle starts');
  }
  const startsAt = patch.startsAt ?? new Date(before.startsAt);
  const endsAt = patch.endsAt ?? new Date(before.endsAt);
  if (patch.startsAt || patch.endsAt) {
    if (!(endsAt > startsAt)) throw new HttpError(400, 'endsAt must be after startsAt');
    await assertNoOverlap(db, before.teamId, startsAt, endsAt, id);
  }
  const set: Partial<typeof cycle.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.startsAt) set.startsAt = patch.startsAt;
  if (patch.endsAt) set.endsAt = patch.endsAt;
  if (Object.keys(set).length) {
    const [row] = await db
      .update(cycle)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(cycle.id, id))
      .returning();
    await sendCycleEvent('update', mapCycle(row!), actorUserId, before);
  }
  if (patch.completedAt) return closeCycle(id, patch.completedAt, now, actorUserId);
  return (await getCycle(id))!;
}

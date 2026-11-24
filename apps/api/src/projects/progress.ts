import { db, issue, issueActivity, project, projectStatus, workflowState } from '@repo/db';
import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import { weighProgress, weighTotals, type Progress, type ProgressIssue } from '../shared/progress';

// Linear's project progress (Project.progress, scope and the five history arrays).
// Progress follows the cycles' rule (shared/progress.ts) over the project's issues.
// The histories hold one value per UTC day from history_start: built from
// issue_activity the first time they are needed (each issue's project and state on
// each past day, worked back from its current values; current estimates are used
// for past days since estimate changes are not recorded), then kept by the worker
// (snapshotProjects), which fills missing days and rewrites today's day on every run,
// so a finished day holds its last snapshot. An open project's value for today is
// always the live one. A project that closes (completed, canceled, archived or
// trashed) has its closing day stored then (closeProjectHistory) and gets no new days.

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = ['completed', 'canceled'];
// Ids per `IN (...)` list, well below Postgres' 65,534 bind parameters.
const BATCH = 1000;
// Projects built per step; the event loop is yielded between steps and each step's
// histories are stored before the next, so an interrupted run keeps its work.
const BUILD_CHUNK = 20;

export interface ProjectHistory {
  issueCountHistory: number[];
  completedIssueCountHistory: number[];
  scopeHistory: number[];
  completedScopeHistory: number[];
  inProgressScopeHistory: number[];
}

const EMPTY_PROGRESS: Progress = weighProgress([]);

const dayOf = (at: Date) => Math.floor(at.getTime() / DAY_MS);
const dayOfDate = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dateOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function batches<T>(list: T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function inBatches<T>(ids: string[], run: (batch: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const batch of batches(ids)) out.push(...(await run(batch)));
  return out;
}

function historyOf(days: Progress[]): ProjectHistory {
  return {
    issueCountHistory: days.map((d) => d.issueCount),
    completedIssueCountHistory: days.map((d) => d.completedIssueCount),
    scopeHistory: days.map((d) => d.scope),
    completedScopeHistory: days.map((d) => d.completedScope),
    inProgressScopeHistory: days.map((d) => d.inProgressScope),
  };
}

function dayAt(h: ProjectHistory, i: number): Progress {
  return {
    progress: 0,
    issueCount: h.issueCountHistory[i]!,
    completedIssueCount: h.completedIssueCountHistory[i]!,
    scope: h.scopeHistory[i]!,
    completedScope: h.completedScopeHistory[i]!,
    inProgressScope: h.inProgressScopeHistory[i]!,
  };
}

const sameHistory = (a: ProjectHistory, b: ProjectHistory) =>
  JSON.stringify(a) === JSON.stringify(b);

// Today's progress of each project, aggregated in SQL.
export async function liveProgressMany(projectIds: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  const counted = sql`${workflowState.stateType} <> 'canceled'`;
  const weight = sql`coalesce(${issue.estimate}, 1)`;
  const rows = await inBatches(projectIds, (batch) =>
    db
      .select({
        projectId: issue.projectId,
        count: sql<number>`count(*) filter (where ${counted})`,
        completedCount: sql<number>`count(*) filter (where ${workflowState.stateType} = 'completed')`,
        startedCount: sql<number>`count(*) filter (where ${workflowState.stateType} = 'started')`,
        weightedSum: sql<number>`coalesce(sum(${weight}) filter (where ${counted}), 0)`,
        completedWeight: sql<number>`coalesce(sum(${weight}) filter (where ${workflowState.stateType} = 'completed'), 0)`,
        startedWeight: sql<number>`coalesce(sum(${weight}) filter (where ${workflowState.stateType} = 'started'), 0)`,
        anyEstimate: sql<boolean>`coalesce(bool_or(${issue.estimate} > 0) filter (where ${counted}), false)`,
        anyOpen: sql<boolean>`coalesce(bool_or(true) filter (where ${workflowState.stateType} not in ('canceled', 'completed')), false)`,
      })
      .from(issue)
      .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
      .where(inArray(issue.projectId, batch))
      .groupBy(issue.projectId),
  );
  for (const r of rows) {
    if (r.projectId == null) continue;
    out.set(
      r.projectId,
      weighTotals({
        count: Number(r.count),
        completedCount: Number(r.completedCount),
        startedCount: Number(r.startedCount),
        weighted: r.anyEstimate,
        weight: Number(r.weightedSum),
        completedWeight: Number(r.completedWeight),
        startedWeight: Number(r.startedWeight),
        anyOpen: r.anyOpen,
      }),
    );
  }
  for (const id of projectIds) if (!out.has(id)) out.set(id, EMPTY_PROGRESS);
  return out;
}

interface ProjectState {
  id: string;
  // The day the series should start on: the start date, else the creation day.
  anchorDay: number;
  // The last day of a closed project's series (the day it was archived, else its
  // last change, which is when it was completed or canceled); null while open.
  endDay: number | null;
  historyStart: string | null;
  open: boolean;
  stored: ProjectHistory;
}

async function loadStates(projectIds: string[]): Promise<ProjectState[]> {
  const rows = await inBatches(projectIds, (batch) =>
    db
      .select({ row: project, statusType: projectStatus.type })
      .from(project)
      .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
      .where(inArray(project.id, batch)),
  );
  return rows.map(({ row, statusType }) => {
    const open = row.archivedAt == null && !CLOSED_STATUSES.includes(statusType);
    return {
      id: row.id,
      anchorDay: row.startDate ? dayOfDate(row.startDate) : dayOf(row.createdAt),
      endDay: open ? null : dayOf(row.archivedAt ?? row.updatedAt),
      historyStart: row.historyStart,
      open,
      stored: {
        issueCountHistory: row.issueCountHistory,
        completedIssueCountHistory: row.completedIssueCountHistory,
        scopeHistory: row.scopeHistory,
        completedScopeHistory: row.completedScopeHistory,
        inProgressScopeHistory: row.inProgressScopeHistory,
      },
    };
  });
}

// A history is built once, and again only when the project's start moved to another
// day that has begun (a start date in the future starts the series today until then).
function needsBuild(p: ProjectState, today: number): boolean {
  if (p.historyStart == null) return true;
  return p.anchorDay <= today && dayOfDate(p.historyStart) !== p.anchorDay;
}

// Stores a history unless another write changed history_start since `p` was read
// (a rebuild after a start-date change), so arrays never mismatch their start.
async function store(p: ProjectState, historyStart: string, history: ProjectHistory) {
  await db
    .update(project)
    .set({ historyStart, ...history })
    .where(
      and(
        eq(project.id, p.id),
        p.historyStart == null
          ? isNull(project.historyStart)
          : eq(project.historyStart, p.historyStart),
      ),
    );
  p.historyStart = historyStart;
  p.stored = history;
}

interface Checkpoint {
  at: number;
  projectId: string | null;
  stateId: string;
}

// Each candidate issue's project and state over time: `initial` before its first
// recorded change, then the values after each change. Changes recorded before ids
// were stored (both ids null) are read as no change.
interface IssueTimeline {
  createdAt: number;
  estimate: number | null;
  initial: { projectId: string | null; stateId: string };
  changes: Checkpoint[];
}

async function loadTimelines(ids: string[]) {
  const moved = await inBatches(ids, (batch) =>
    db
      .selectDistinct({ id: issueActivity.issueId })
      .from(issueActivity)
      .where(
        and(
          eq(issueActivity.action, 'project'),
          or(inArray(issueActivity.fromId, batch), inArray(issueActivity.toId, batch)),
        ),
      ),
  );
  const current = await inBatches(ids, (batch) =>
    db.select({ id: issue.id }).from(issue).where(inArray(issue.projectId, batch)),
  );
  const candidateIds = [
    ...new Set([...current.map((r) => r.id), ...moved.map((r) => r.id)]),
  ].filter((id): id is string => id != null);

  const issues = await inBatches(candidateIds, (batch) =>
    db
      .select({
        id: issue.id,
        projectId: issue.projectId,
        stateId: issue.stateId,
        estimate: issue.estimate,
        createdAt: issue.createdAt,
      })
      .from(issue)
      .where(inArray(issue.id, batch)),
  );
  const activity = await inBatches(
    issues.map((i) => i.id),
    (batch) =>
      db
        .select({
          issueId: issueActivity.issueId,
          action: issueActivity.action,
          fromId: issueActivity.fromId,
          toId: issueActivity.toId,
          createdAt: issueActivity.createdAt,
        })
        .from(issueActivity)
        .where(
          and(
            inArray(issueActivity.issueId, batch),
            inArray(issueActivity.action, ['project', 'status']),
          ),
        ),
  );

  const stateIds = new Set<string>(issues.map((i) => i.stateId));
  for (const a of activity) {
    if (a.action !== 'status') continue;
    if (a.fromId) stateIds.add(a.fromId);
    if (a.toId) stateIds.add(a.toId);
  }
  const stateTypes = new Map(
    (
      await inBatches([...stateIds], (batch) =>
        db
          .select({ id: workflowState.id, type: workflowState.stateType })
          .from(workflowState)
          .where(inArray(workflowState.id, batch)),
      )
    ).map((s) => [s.id, s.type]),
  );

  const byIssue = new Map<string, typeof activity>();
  for (const a of activity) {
    if (a.issueId == null) continue;
    const list = byIssue.get(a.issueId) ?? [];
    list.push(a);
    byIssue.set(a.issueId, list);
  }
  // Each timeline is indexed under every project the issue was ever in, so a
  // project's days look only at its own issues.
  const byProject = new Map<string, IssueTimeline[]>();
  for (const i of issues) {
    const events = (byIssue.get(i.id) ?? [])
      .filter((e) => e.fromId != null || e.toId != null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    let cur = { projectId: i.projectId, stateId: i.stateId };
    const changes: Checkpoint[] = [];
    for (const e of events) {
      changes.push({ at: e.createdAt.getTime(), ...cur });
      if (e.action === 'project') cur = { ...cur, projectId: e.fromId };
      else if (e.fromId) cur = { ...cur, stateId: e.fromId };
    }
    const timeline: IssueTimeline = {
      createdAt: i.createdAt.getTime(),
      estimate: i.estimate,
      initial: cur,
      changes: changes.reverse(),
    };
    const projects = new Set([cur.projectId, ...changes.map((c) => c.projectId)]);
    for (const id of projects) {
      if (id == null) continue;
      const list = byProject.get(id) ?? [];
      list.push(timeline);
      byProject.set(id, list);
    }
  }
  return { byProject, stateTypes };
}

// The project's days from `start` to `end`, each the state at the end of that day
// (or `now` for today), walking each issue's changes once.
function daysOf(
  projectId: string,
  timelines: IssueTimeline[],
  stateTypes: Map<string, string>,
  start: number,
  end: number,
  now: Date,
): Progress[] {
  const rows: ProgressIssue[][] = Array.from({ length: end - start + 1 }, () => []);
  for (const t of timelines) {
    let value = t.initial;
    let next = 0;
    for (let day = start; day <= end; day++) {
      const at = Math.min((day + 1) * DAY_MS - 1, now.getTime());
      if (t.createdAt > at) continue;
      while (next < t.changes.length && t.changes[next]!.at <= at) value = t.changes[next++]!;
      if (value.projectId !== projectId) continue;
      rows[day - start]!.push({
        estimate: t.estimate,
        type: stateTypes.get(value.stateId) ?? 'backlog',
      });
    }
  }
  return rows.map(weighProgress);
}

// Builds the histories of `projects` from issue_activity, a chunk at a time: an open
// project up to today, a closed one up to the day it closed. Stored unless `persist`
// is false (then only `projects` is updated).
async function build(projects: ProjectState[], now: Date, persist = true): Promise<void> {
  const today = dayOf(now);
  for (const chunk of batches(projects, BUILD_CHUNK)) {
    const { byProject, stateTypes } = await loadTimelines(chunk.map((p) => p.id));
    for (const p of chunk) {
      const start = Math.min(p.anchorDay, today);
      const end = Math.max(start, Math.min(today, p.endDay ?? today));
      const days = daysOf(p.id, byProject.get(p.id) ?? [], stateTypes, start, end, now);
      if (persist) await store(p, dateOfDay(start), historyOf(days));
      else {
        p.historyStart = dateOfDay(start);
        p.stored = historyOf(days);
      }
    }
    await yieldToLoop();
  }
}

// The stored days up to yesterday (a missed day reads as `value`) and `value` for
// today.
function withToday(p: ProjectState, value: Progress, today: number): ProjectHistory {
  const todayIndex = today - dayOfDate(p.historyStart!);
  const days: Progress[] = [];
  for (let i = 0; i < todayIndex; i++)
    days.push(i < p.stored.issueCountHistory.length ? dayAt(p.stored, i) : value);
  days.push(value);
  return historyOf(days);
}

// The served histories of `projectIds` (missing projects are left out), building
// any that are not built yet (stored, unless `persist` is false: webhook data is
// read while a project is being written, before its issues may be in place). An open
// project's past days come from the stored history and today is live; a closed
// project's history is served as stored.
export async function projectHistories(
  projectIds: string[],
  now: Date,
  { persist = true }: { persist?: boolean } = {},
): Promise<Map<string, ProjectHistory>> {
  const states = await loadStates(projectIds);
  const today = dayOf(now);
  await build(
    states.filter((p) => needsBuild(p, today)),
    now,
    persist,
  );
  const live = await liveProgressMany(states.filter((p) => p.open).map((p) => p.id));
  const out = new Map<string, ProjectHistory>();
  for (const p of states)
    out.set(p.id, p.open ? withToday(p, live.get(p.id) ?? EMPTY_PROGRESS, today) : p.stored);
  return out;
}

// Stores today's values in each project's history, filling missing days with them
// and rewriting today's day. Returns the projects whose history changed.
async function storeToday(states: ProjectState[], now: Date): Promise<number> {
  const today = dayOf(now);
  const toBuild = states.filter((p) => needsBuild(p, today));
  await build(toBuild, now);
  const rest = states.filter((p) => !toBuild.includes(p));
  let changed = toBuild.length;
  for (const chunk of batches(rest, BATCH)) {
    const live = await liveProgressMany(chunk.map((p) => p.id));
    for (const p of chunk) {
      const next = withToday(p, live.get(p.id) ?? EMPTY_PROGRESS, today);
      if (sameHistory(next, p.stored)) continue;
      await store(p, p.historyStart!, next);
      changed++;
    }
    await yieldToLoop();
  }
  return changed;
}

// The worker's step, run hourly: each open project's history gains its missing days
// and today's latest values. A history not built yet is built from issue_activity.
export async function snapshotProjects(now: Date): Promise<number> {
  const open = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(and(isNull(project.archivedAt), notInArray(projectStatus.type, CLOSED_STATUSES)));
  return storeToday(await loadStates(open.map((r) => r.id)), now);
}

// Stores the closing day of a project that was just completed, canceled, archived or
// trashed: its history then ends on that day with its final values.
export async function closeProjectHistory(projectId: string, now: Date): Promise<void> {
  const states = await loadStates([projectId]);
  await storeToday(states, now);
}

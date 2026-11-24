import { db, issue, issueActivity, project, projectStatus, workflowState } from '@repo/db';
import { and, eq, inArray, isNull, notInArray, or } from 'drizzle-orm';
import { weighProgress, type Progress, type ProgressIssue } from '../shared/progress';

// Linear's project progress (Project.progress, scope and the five history arrays).
// Progress follows the cycles' rule (shared/progress.ts) over the project's issues.
// The histories hold one value per UTC day from history_start: built from
// issue_activity the first time they are needed (each issue's project and state on
// each past day, worked back from its current values; current estimates are used
// for past days since estimate changes are not recorded), then appended daily by
// the worker (snapshotProjects). An open project's value for today is always the
// live one; a completed, canceled, archived or trashed project gets no new days.

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_STATUSES = ['completed', 'canceled'];

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

// Today's progress of each project, in one query.
export async function liveProgressMany(projectIds: string[]): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select({ projectId: issue.projectId, estimate: issue.estimate, type: workflowState.stateType })
    .from(issue)
    .innerJoin(workflowState, eq(workflowState.id, issue.stateId))
    .where(inArray(issue.projectId, projectIds));
  const byProject = new Map<string, ProgressIssue[]>();
  for (const r of rows) {
    if (r.projectId == null) continue;
    const list = byProject.get(r.projectId) ?? [];
    list.push(r);
    byProject.set(r.projectId, list);
  }
  for (const id of projectIds) out.set(id, weighProgress(byProject.get(id) ?? []));
  return out;
}

export async function projectProgress(projectId: string): Promise<Progress> {
  return (await liveProgressMany([projectId])).get(projectId) ?? EMPTY_PROGRESS;
}

interface ProjectState {
  id: string;
  // The day the series should start on: the start date, else the creation day.
  anchorDay: number;
  historyStart: string | null;
  open: boolean;
  stored: ProjectHistory;
}

async function loadStates(projectIds: string[]): Promise<ProjectState[]> {
  if (projectIds.length === 0) return [];
  const rows = await db
    .select({ row: project, statusType: projectStatus.type })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(inArray(project.id, projectIds));
  return rows.map(({ row, statusType }) => ({
    id: row.id,
    anchorDay: row.startDate ? dayOfDate(row.startDate) : dayOf(row.createdAt),
    historyStart: row.historyStart,
    open: row.archivedAt == null && !CLOSED_STATUSES.includes(statusType),
    stored: {
      issueCountHistory: row.issueCountHistory,
      completedIssueCountHistory: row.completedIssueCountHistory,
      scopeHistory: row.scopeHistory,
      completedScopeHistory: row.completedScopeHistory,
      inProgressScopeHistory: row.inProgressScopeHistory,
    },
  }));
}

// A history is built once, and again only when the project's start moved to another
// day that has begun (a start date in the future starts the series today until then).
function needsBuild(p: ProjectState, today: number): boolean {
  if (p.historyStart == null) return true;
  return p.anchorDay <= today && dayOfDate(p.historyStart) !== p.anchorDay;
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

function valueAt(t: IssueTimeline, at: number): { projectId: string | null; stateId: string } {
  let value = t.initial;
  for (const c of t.changes) {
    if (c.at > at) break;
    value = c;
  }
  return value;
}

// Builds and stores the histories of `projects` from issue_activity up to today.
async function build(projects: ProjectState[], now: Date): Promise<void> {
  if (projects.length === 0) return;
  const ids = projects.map((p) => p.id);
  const moved = await db
    .selectDistinct({ id: issueActivity.issueId })
    .from(issueActivity)
    .where(
      and(
        eq(issueActivity.action, 'project'),
        or(inArray(issueActivity.fromId, ids), inArray(issueActivity.toId, ids)),
      ),
    );
  const current = await db
    .select({ id: issue.id })
    .from(issue)
    .where(inArray(issue.projectId, ids));
  const candidateIds = [
    ...new Set([...current.map((r) => r.id), ...moved.map((r) => r.id)]),
  ].filter((id): id is string => id != null);

  const issues = candidateIds.length
    ? await db
        .select({
          id: issue.id,
          projectId: issue.projectId,
          stateId: issue.stateId,
          estimate: issue.estimate,
          createdAt: issue.createdAt,
        })
        .from(issue)
        .where(inArray(issue.id, candidateIds))
    : [];
  const activity = issues.length
    ? await db
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
            inArray(
              issueActivity.issueId,
              issues.map((i) => i.id),
            ),
            inArray(issueActivity.action, ['project', 'status']),
          ),
        )
    : [];

  const stateIds = new Set<string>(issues.map((i) => i.stateId));
  for (const a of activity) {
    if (a.action !== 'status') continue;
    if (a.fromId) stateIds.add(a.fromId);
    if (a.toId) stateIds.add(a.toId);
  }
  const stateTypes = new Map(
    stateIds.size
      ? (
          await db
            .select({ id: workflowState.id, type: workflowState.stateType })
            .from(workflowState)
            .where(inArray(workflowState.id, [...stateIds]))
        ).map((s) => [s.id, s.type])
      : [],
  );

  const byIssue = new Map<string, typeof activity>();
  for (const a of activity) {
    if (a.issueId == null) continue;
    const list = byIssue.get(a.issueId) ?? [];
    list.push(a);
    byIssue.set(a.issueId, list);
  }
  const timelines = issues.map((i): IssueTimeline => {
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
    return {
      createdAt: i.createdAt.getTime(),
      estimate: i.estimate,
      initial: cur,
      changes: changes.reverse(),
    };
  });

  const today = dayOf(now);
  for (const p of projects) {
    const start = Math.min(p.anchorDay, today);
    const days: Progress[] = [];
    for (let day = start; day <= today; day++) {
      const at = Math.min((day + 1) * DAY_MS - 1, now.getTime());
      const rows: ProgressIssue[] = [];
      for (const t of timelines) {
        if (t.createdAt > at) continue;
        const v = valueAt(t, at);
        if (v.projectId !== p.id) continue;
        rows.push({ estimate: t.estimate, type: stateTypes.get(v.stateId) ?? 'backlog' });
      }
      days.push(weighProgress(rows));
    }
    const history = historyOf(days);
    await db
      .update(project)
      .set({ historyStart: dateOfDay(start), ...history })
      .where(eq(project.id, p.id));
    p.historyStart = dateOfDay(start);
    p.stored = history;
  }
}

// The served histories of `projectIds` (missing projects are left out), building
// any that are not built yet. An open project's past days come from the stored
// history (a day the worker missed reads as today's values) and today is live; a
// closed, archived or trashed project's history is served as stored.
export async function projectHistories(
  projectIds: string[],
  now: Date,
): Promise<Map<string, ProjectHistory>> {
  const states = await loadStates(projectIds);
  const today = dayOf(now);
  await build(
    states.filter((p) => needsBuild(p, today)),
    now,
  );
  const live = await liveProgressMany(states.filter((p) => p.open).map((p) => p.id));
  const out = new Map<string, ProjectHistory>();
  for (const p of states) {
    if (!p.open) {
      out.set(p.id, p.stored);
      continue;
    }
    const now_ = live.get(p.id) ?? EMPTY_PROGRESS;
    const todayIndex = today - dayOfDate(p.historyStart!);
    const days: Progress[] = [];
    for (let i = 0; i < todayIndex; i++)
      days.push(i < p.stored.issueCountHistory.length ? dayAt(p.stored, i) : now_);
    days.push(now_);
    out.set(p.id, historyOf(days));
  }
  return out;
}

// The worker's daily step: each open project's history gains the days up to today
// it does not have yet, with today's values (a missed day is filled the same way).
// A history not built yet is built from issue_activity instead. Returns the number
// of projects changed.
export async function snapshotProjects(now: Date): Promise<number> {
  const open = await db
    .select({ id: project.id })
    .from(project)
    .innerJoin(projectStatus, eq(projectStatus.id, project.statusId))
    .where(and(isNull(project.archivedAt), notInArray(projectStatus.type, CLOSED_STATUSES)));
  const states = await loadStates(open.map((r) => r.id));
  const today = dayOf(now);
  const toBuild = states.filter((p) => needsBuild(p, today));
  await build(toBuild, now);
  const rest = states.filter((p) => !toBuild.includes(p));
  const live = await liveProgressMany(rest.map((p) => p.id));
  let changed = toBuild.length;
  for (const p of rest) {
    const length = p.stored.issueCountHistory.length;
    const missing = today - dayOfDate(p.historyStart!) + 1 - length;
    if (missing <= 0) continue;
    const value = live.get(p.id) ?? EMPTY_PROGRESS;
    const days = [
      ...Array.from({ length }, (_, i) => dayAt(p.stored, i)),
      ...Array<Progress>(missing).fill(value),
    ];
    await db.update(project).set(historyOf(days)).where(eq(project.id, p.id));
    changed++;
  }
  return changed;
}

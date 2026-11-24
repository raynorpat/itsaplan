import { beforeEach, describe, expect, it } from 'bun:test';
import { db, issueActivity, project as projectTable, PROJECT_STATUS_IDS } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createProject,
  createTeam,
  gqlData,
  statesByType,
  updateIssue,
  type As,
} from '../../../__tests__/helpers/graphql';
import { batches, projectHistories, snapshotProjects } from '../../progress';

// Linear's project progress: the cycles' rule (completed 1, started 0.25, canceled
// left out, weighted by estimate when any issue has one) and one history value per
// UTC day from the start date, rebuilt from issue history on first need and then
// appended daily by the worker.

const DAY_MS = 24 * 60 * 60 * 1000;
const dayStart = (offsetDays: number) => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + offsetDays * DAY_MS);
};
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id, states: statesByType(view) };
}

const FIELDS = `progress scope scopeHistory completedScopeHistory inProgressScopeHistory issueCountHistory completedIssueCountHistory`;

async function readProject(as: As, id: string) {
  const data = await gqlData(as, `query ($id: String!) { project(id: $id) { ${FIELDS} } }`, {
    id,
  });
  return data.project as {
    progress: number;
    scope: number;
    scopeHistory: number[];
    completedScopeHistory: number[];
    inProgressScopeHistory: number[];
    issueCountHistory: number[];
    completedIssueCountHistory: number[];
  };
}

// Moves an issue's recorded change of `action` to `at` (the API records changes at
// the time they are made; the history is about past days).
async function backdate(issueId: string, action: string, at: Date) {
  await db
    .update(issueActivity)
    .set({ createdAt: at })
    .where(and(eq(issueActivity.issueId, issueId), eq(issueActivity.action, action)));
}

describe('project progress', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('weighs completed, started and canceled issues by estimate', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    const add = (stateId: string, estimate: number) =>
      createIssue(owner, { teamId, projectId: p.id, stateId, estimate });
    await add(states.completed!, 3);
    await add(states.started!, 2);
    await add(states.unstarted!, 5);
    await add(states.canceled!, 4);
    const read = await readProject(owner, p.id);
    expect(read.scope).toBe(10);
    expect(read.progress).toBeCloseTo((3 + 0.25 * 2) / 10);
  });

  it('counts issues when none has an estimate', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    for (const s of [states.completed!, states.started!, states.unstarted!, states.unstarted!])
      await createIssue(owner, { teamId, projectId: p.id, stateId: s });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.canceled! });
    const read = await readProject(owner, p.id);
    expect(read.scope).toBe(4);
    expect(read.progress).toBeCloseTo((1 + 0.25) / 4);
  });

  it('rebuilds the daily history from issue history', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, {
      name: 'Q3',
      teamIds: [teamId],
      startDate: dateOnly(dayStart(-5)),
    });
    const created = new Date(dayStart(-5).getTime() + 60 * 60 * 1000).toISOString();
    // In the project from its start, never changed.
    await createIssue(owner, {
      teamId,
      projectId: p.id,
      stateId: states.unstarted!,
      createdAt: created,
    });
    // Moved in on day 2, completed on day 4.
    const moved = await createIssue(owner, {
      teamId,
      stateId: states.unstarted!,
      createdAt: created,
    });
    await updateIssue(owner, moved.id, { projectId: p.id });
    await updateIssue(owner, moved.id, { stateId: states.completed! });
    await backdate(moved.id, 'project', new Date(dayStart(-3).getTime() + 12 * 60 * 60 * 1000));
    await backdate(moved.id, 'status', new Date(dayStart(-1).getTime() + 12 * 60 * 60 * 1000));

    const read = await readProject(owner, p.id);
    expect(read.issueCountHistory).toEqual([1, 1, 2, 2, 2, 2]);
    expect(read.completedIssueCountHistory).toEqual([0, 0, 0, 0, 1, 1]);
    expect(read.scopeHistory).toEqual([1, 1, 2, 2, 2, 2]);
    expect(read.completedScopeHistory).toEqual([0, 0, 0, 0, 1, 1]);
    expect(read.inProgressScopeHistory).toEqual([0, 0, 0, 0, 0, 0]);
    expect(read.scopeHistory.at(-1)).toBe(read.scope);
  });

  it('gives a project created today one value per history', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.started! });
    const read = await readProject(owner, p.id);
    expect(read.issueCountHistory).toEqual([1]);
    expect(read.scopeHistory).toEqual([1]);
    expect(read.inProgressScopeHistory).toEqual([1]);
    expect(read.completedScopeHistory).toEqual([0]);
  });

  it('appends one day per snapshot day and fills a missed day', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    const later = await createIssue(owner, {
      teamId,
      projectId: p.id,
      stateId: states.unstarted!,
    });
    const at = (days: number) => new Date(Date.now() + days * DAY_MS);

    await snapshotProjects(at(1));
    await snapshotProjects(at(1));
    await updateIssue(owner, later.id, { stateId: states.completed! });
    // Day 2 is missed; day 3's snapshot fills it.
    await snapshotProjects(at(3));

    const [history] = [...(await projectHistories([p.id], at(4))).values()];
    expect(history!.completedIssueCountHistory).toEqual([0, 0, 1, 1, 1]);
    expect(history!.issueCountHistory).toEqual([1, 1, 1, 1, 1]);
  });

  it('takes no snapshot of a completed or trashed project', async () => {
    const { owner, teamId, states } = await setup();
    const done = await createProject(owner, { name: 'Done', teamIds: [teamId] });
    const trashed = await createProject(owner, { name: 'Gone', teamIds: [teamId] });
    for (const p of [done, trashed])
      await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    // Built today.
    await readProject(owner, done.id);
    await readProject(owner, trashed.id);
    await gqlData(
      owner,
      `mutation ($id: String!, $status: String!) { projectUpdate(id: $id, input: { statusId: $status }) { success } }`,
      { id: done.id, status: PROJECT_STATUS_IDS.completed },
    );
    await gqlData(owner, `mutation ($id: String!) { projectDelete(id: $id) { success } }`, {
      id: trashed.id,
    });

    const at = new Date(Date.now() + 2 * DAY_MS);
    await snapshotProjects(at);
    const histories = await projectHistories([done.id, trashed.id], at);
    expect(histories.get(done.id)!.issueCountHistory).toEqual([1]);
    expect(histories.get(trashed.id)!.issueCountHistory).toEqual([1]);
  });
  it('keeps zero estimates and the 0.999 cap in the live progress', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.completed!, estimate: 3 });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted!, estimate: 0 });
    const read = await readProject(owner, p.id);
    expect(read.scope).toBe(3);
    expect(read.progress).toBe(0.999);
  });

  it("overwrites today's stored day on each snapshot", async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    const one = await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    const tomorrow = dayStart(1);
    await snapshotProjects(new Date(tomorrow.getTime() + 60 * 60 * 1000));
    await updateIssue(owner, one.id, { stateId: states.completed! });
    await snapshotProjects(new Date(tomorrow.getTime() + 20 * 60 * 60 * 1000));
    const [history] = [...(await projectHistories([p.id], dayStart(3))).values()];
    // Day 1 holds its last snapshot (the completion), not the first one of the day.
    expect(history!.completedIssueCountHistory.slice(0, 2)).toEqual([0, 1]);
  });

  it('stores the closing day of a project that is completed, and stops there', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, { name: 'Q3', teamIds: [teamId] });
    const one = await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    await readProject(owner, p.id);
    await updateIssue(owner, one.id, { stateId: states.completed! });
    await gqlData(
      owner,
      `mutation ($id: String!, $status: String!) { projectUpdate(id: $id, input: { statusId: $status }) { success } }`,
      { id: p.id, status: PROJECT_STATUS_IDS.completed },
    );
    const [history] = [...(await projectHistories([p.id], dayStart(4))).values()];
    expect(history!.completedIssueCountHistory).toEqual([1]);
    expect(history!.issueCountHistory).toEqual([1]);
  });

  it('builds a closed project only up to the day it closed', async () => {
    const { owner, teamId, states } = await setup();
    const p = await createProject(owner, {
      name: 'Q3',
      teamIds: [teamId],
      startDate: dateOnly(dayStart(-3)),
    });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.completed! });
    // Closed today before its history was ever built.
    await db
      .update(projectTable)
      .set({ statusId: PROJECT_STATUS_IDS.completed })
      .where(eq(projectTable.id, p.id));
    const [history] = [...(await projectHistories([p.id], dayStart(10))).values()];
    expect(history!.issueCountHistory).toHaveLength(4);
  });

  it('builds many projects with moving issues correctly', async () => {
    const { owner, teamId, states } = await setup();
    const start = dateOnly(dayStart(-2));
    const projects = [];
    for (let i = 0; i < 30; i++)
      projects.push(
        await createProject(owner, { name: `P${i}`, teamIds: [teamId], startDate: start }),
      );
    for (let i = 0; i < 30; i++) {
      const p = projects[i]!;
      for (let j = 0; j < 6; j++) {
        const created = await createIssue(owner, {
          teamId,
          projectId: p.id,
          stateId: j % 3 === 0 ? states.completed! : states.unstarted!,
          estimate: j,
        });
        // Every third issue moves to the next project.
        if (j % 3 === 1)
          await updateIssue(owner, created.id, { projectId: projects[(i + 1) % 30]!.id });
      }
    }
    await snapshotProjects(new Date());
    const live = await gqlData(
      owner,
      `query { projects(first: 50) { nodes { id scope scopeHistory issueCountHistory } } }`,
      {},
    );
    for (const n of live.projects.nodes as {
      scope: number;
      scopeHistory: number[];
      issueCountHistory: number[];
    }[]) {
      expect(n.scopeHistory).toHaveLength(3);
      expect(n.scopeHistory.at(-1)).toBe(n.scope);
      expect(n.issueCountHistory.at(-1)).toBe(6);
    }
  }, 30_000); // Builds 30 projects through the API; slower than the 5 s default in a full run.

  it('splits long id lists into batches', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createIssue,
  createProject,
  createTeam,
  gqlData,
  statesByType,
  updateTeam,
  type As,
} from '../../../__tests__/helpers/graphql';
import { createCycle, cycleProgress } from '../../../cycles/store';
import { projectHistories } from '../../../projects/progress';

// An issue without an estimate counts as its own team's `defaultIssueEstimate` in the
// weighted progress of cycles and projects (Linear's Team.defaultIssueEstimate).

async function team(as: As, key: string, defaultIssueEstimate: number) {
  const view = await createTeam(as, { key, name: key });
  await updateTeam(as, key, { issueEstimationType: 'fibonacci', defaultIssueEstimate });
  return { teamId: view.team.id as string, states: statesByType(view) };
}

async function projectScope(as: As, id: string): Promise<number> {
  const data = await gqlData(as, `query ($id: String!) { project(id: $id) { scope } }`, { id });
  return (data.project as { scope: number }).scope;
}

describe("progress uses the team's default estimate", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('counts an unestimated issue as 0 when the default is 0', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const { teamId, states } = await team(owner, 'ENG', 0);
    const p = await createProject(owner, { name: 'P', teamIds: [teamId] });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted!, estimate: 3 });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    expect(await projectScope(owner, p.id)).toBe(3);
  });

  it('counts an unestimated issue as 2 when the default is 2', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const { teamId, states } = await team(owner, 'ENG', 2);
    const p = await createProject(owner, { name: 'P', teamIds: [teamId] });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted!, estimate: 3 });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    expect(await projectScope(owner, p.id)).toBe(5);
    const histories = await projectHistories([p.id], new Date());
    expect(histories.get(p.id)!.scopeHistory.at(-1)).toBe(5);
  });

  it("uses each issue's own team default in a project spanning two teams", async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const a = await team(owner, 'AAA', 0);
    const b = await team(owner, 'BBB', 3);
    const p = await createProject(owner, { name: 'P', teamIds: [a.teamId, b.teamId] });
    await createIssue(owner, {
      teamId: a.teamId,
      projectId: p.id,
      stateId: a.states.unstarted!,
      estimate: 3,
    });
    await createIssue(owner, { teamId: a.teamId, projectId: p.id, stateId: a.states.unstarted! });
    await createIssue(owner, { teamId: b.teamId, projectId: p.id, stateId: b.states.unstarted! });
    expect(await projectScope(owner, p.id)).toBe(6);
  });

  it("counts an unestimated cycle issue as the team's default", async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const { teamId, states } = await team(owner, 'ENG', 0);
    await updateTeam(owner, 'ENG', { cyclesEnabled: true });
    const start = new Date(Date.now() + 400 * 86_400_000);
    const cycle = await createCycle(
      teamId,
      { startsAt: start, endsAt: new Date(start.getTime() + 7 * 86_400_000) },
      owner.userId,
    );
    await createIssue(owner, {
      teamId,
      cycleId: cycle.id,
      stateId: states.unstarted!,
      estimate: 3,
    });
    await createIssue(owner, { teamId, cycleId: cycle.id, stateId: states.unstarted! });
    expect((await cycleProgress(cycle.id)).scope).toBe(3);
  });

  it('ignores the stored estimates of a team that turned estimates off', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const { teamId, states } = await team(owner, 'ENG', 0);
    const p = await createProject(owner, { name: 'P', teamIds: [teamId] });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.completed!, estimate: 8 });
    await createIssue(owner, { teamId, projectId: p.id, stateId: states.unstarted! });
    await updateTeam(owner, 'ENG', { issueEstimationType: 'notUsed' });
    // Counted by issue: 2 issues, 1 completed; the hidden 8 and the default 0 play no part.
    expect(await projectScope(owner, p.id)).toBe(2);
    const histories = await projectHistories([p.id], new Date());
    expect(histories.get(p.id)!.scopeHistory.at(-1)).toBe(2);
  });

  it('counts a team with estimates off by issue inside a weighted project', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const a = await team(owner, 'AAA', 1);
    const b = await team(owner, 'BBB', 0);
    await updateTeam(owner, 'BBB', { issueEstimationType: 'notUsed' });
    const p = await createProject(owner, { name: 'P', teamIds: [a.teamId, b.teamId] });
    await createIssue(owner, {
      teamId: a.teamId,
      projectId: p.id,
      stateId: a.states.unstarted!,
      estimate: 5,
    });
    await createIssue(owner, { teamId: b.teamId, projectId: p.id, stateId: b.states.unstarted! });
    // 5 from AAA, and BBB's issue counts 1 (by issue), not its team's default of 0.
    expect(await projectScope(owner, p.id)).toBe(6);
  });
});

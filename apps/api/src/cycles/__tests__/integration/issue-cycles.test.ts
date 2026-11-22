import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { archiveCycle, listCycles, setTeamCycleSettings } from '../../store';
import { createMilestone } from '../../../projects/milestones';

// Issues in cycles over REST: a cycle of the issue's team only, and auto-assign to
// the active cycle when an issue is started or completed.

async function setup(settings: Parameters<typeof setTeamCycleSettings>[1] = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  await setTeamCycleSettings(team.team.id, { enabled: true, ...settings });
  const cycles = await listCycles(team.team.id);
  const state = (type: string) => team.states.filter((s) => s.stateType === type)[0]!.id;
  const create = (stateId: string, extra: Record<string, unknown> = {}) =>
    asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'x', ...extra });
  return { owner, asOwner, team, cycles, state, create };
}

describe('issues in cycles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sets and clears an issue's cycle over REST and logs it", async () => {
    const { asOwner, cycles, state, create } = await setup();
    const issue = (await create(state('unstarted'))).data!;
    const set = await asOwner.issues({ issueId: issue.id }).patch({ cycleId: cycles[0]!.id });
    expect(set.data!.cycleId).toBe(cycles[0]!.id);
    const cleared = await asOwner.issues({ issueId: issue.id }).patch({ cycleId: null });
    expect(cleared.data!.cycleId).toBeNull();
    const feed = await asOwner.issues({ issueId: issue.id }).feed.get();
    expect(feed.data!.items.filter((i) => i.action === 'cycle')).toHaveLength(2);
  });

  it("rejects another team's cycle and an archived cycle", async () => {
    const { owner, asOwner, cycles, state, create } = await setup();
    await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!;
    await setTeamCycleSettings(ops.team.id, { enabled: true });
    const opsCycle = (await listCycles(ops.team.id))[0]!;
    const issue = (await create(state('unstarted'))).data!;
    expect(
      (await asOwner.issues({ issueId: issue.id }).patch({ cycleId: opsCycle.id })).status,
    ).toBe(400);
    await archiveCycle(cycles[2]!.id, owner.userId, new Date());
    expect(
      (await asOwner.issues({ issueId: issue.id }).patch({ cycleId: cycles[2]!.id })).status,
    ).toBe(400);
  });

  it('auto-assigns on start, on create in a started state, and between started states', async () => {
    const { asOwner, cycles, state, create } = await setup({ autoAssignStarted: true });
    const active = cycles[0]!.id;
    const moved = (await create(state('unstarted'))).data!;
    const res = await asOwner.issues({ issueId: moved.id }).patch({ stateId: state('started') });
    expect(res.data!.cycleId).toBe(active);
    expect((await create(state('started'))).data!.cycleId).toBe(active);
    const review = (
      await asOwner.teams({ teamKey: 'MKT' }).states.post({ name: 'Review', stateType: 'started' })
    ).data!;
    const between = (await create(state('started'), { cycleId: null })).data!;
    expect(between.cycleId).toBeNull();
    const again = await asOwner.issues({ issueId: between.id }).patch({ stateId: review.id });
    expect(again.data!.cycleId).toBe(active);
  });

  it('lets an explicit cycleId, including null, win over auto-assign', async () => {
    const { asOwner, cycles, state, create } = await setup({ autoAssignStarted: true });
    const issue = (await create(state('unstarted'))).data!;
    const res = await asOwner
      .issues({ issueId: issue.id })
      .patch({ stateId: state('started'), cycleId: cycles[1]!.id });
    expect(res.data!.cycleId).toBe(cycles[1]!.id);
    const other = (await create(state('unstarted'))).data!;
    const kept = await asOwner
      .issues({ issueId: other.id })
      .patch({ stateId: state('started'), cycleId: null });
    expect(kept.data!.cycleId).toBeNull();
  });

  it('auto-assigns completed issues only when that setting is on', async () => {
    const { asOwner, cycles, state, create } = await setup({ autoAssignCompleted: true });
    const started = (await create(state('started'))).data!;
    expect(started.cycleId).toBeNull();
    const done = await asOwner
      .issues({ issueId: started.id })
      .patch({ stateId: state('completed') });
    expect(done.data!.cycleId).toBe(cycles[0]!.id);
  });

  it('keeps a milestone set together with a project in one patch', async () => {
    const { asOwner, team, state, create } = await setup();
    const a = (await asOwner.projects.post({ name: 'A', teamIds: [team.team.id] })).data!;
    const b = (await asOwner.projects.post({ name: 'B', teamIds: [team.team.id] })).data!;
    const mb = await createMilestone(b.id, { name: 'Beta' });
    const issue = (await create(state('unstarted'), { projectId: a.id })).data!;
    const res = await asOwner
      .issues({ issueId: issue.id })
      .patch({ projectId: b.id, projectMilestoneId: mb.id });
    expect(res.data).toMatchObject({ projectMilestoneId: mb.id });
  });
});

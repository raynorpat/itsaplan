import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  createProject,
  createState,
  createTeam,
  gqlData,
  statesByType,
  type As,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { archiveCycle, listCycles, setTeamCycleSettings } from '../../store';
import { createMilestone } from '../../../projects/milestones';

// Issues in cycles: a cycle of the issue's team only, and auto-assign to the active
// cycle when an issue is started or completed.

const ISSUE = 'id cycle { id } projectMilestone { id }';

async function createIssue(as: As, input: Record<string, unknown>) {
  const data = await gqlData(
    as,
    `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { issue { ${ISSUE} } } }`,
    { input: { title: 'x', ...input } },
  );
  return data.issueCreate.issue as { id: string; cycle: { id: string } | null };
}

function update(as: As, id: string, input: Record<string, unknown>) {
  return gql(
    { cookie: (as as { cookie: string }).cookie },
    `mutation ($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { issue { ${ISSUE} } } }`,
    { id, input },
  );
}

const issueOf = (res: Awaited<ReturnType<typeof update>>) =>
  (res.body.data as { issueUpdate: { issue: { cycle: { id: string } | null } } }).issueUpdate.issue;

async function setup(settings: Parameters<typeof setTeamCycleSettings>[1] = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  const teamId = view.team.id;
  await setTeamCycleSettings(teamId, { enabled: true, ...settings });
  const cycles = await listCycles(teamId);
  const states = statesByType(view);
  const state = (type: string) => states[type]!;
  const create = (stateId: string, extra: Record<string, unknown> = {}) =>
    createIssue(owner, { teamId, stateId, ...extra });
  return { owner, teamId, cycles, state, create };
}

describe('issues in cycles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sets and clears an issue's cycle and logs it", async () => {
    const { owner, cycles, state, create } = await setup();
    const issue = await create(state('unstarted'));
    const set = await update(owner, issue.id, { cycleId: cycles[0]!.id });
    expect(issueOf(set).cycle?.id).toBe(cycles[0]!.id);
    const cleared = await update(owner, issue.id, { cycleId: null });
    expect(issueOf(cleared).cycle).toBeNull();
    const data = await gqlData(
      owner,
      `query ($id: String!) { issue(id: $id) { history { nodes { fromCycleId toCycleId } } } }`,
      { id: issue.id },
    );
    const changes = (
      data.issue.history.nodes as { fromCycleId: string | null; toCycleId: string | null }[]
    ).filter((h) => h.fromCycleId || h.toCycleId);
    expect(changes).toHaveLength(2);
  });

  it("rejects another team's cycle and an archived cycle", async () => {
    const { owner, cycles, state, create } = await setup();
    const ops = await createTeam(owner, { key: 'OPS', name: 'Operations' });
    await setTeamCycleSettings(ops.team.id, { enabled: true });
    const opsCycle = (await listCycles(ops.team.id))[0]!;
    const issue = await create(state('unstarted'));
    const other = await update(owner, issue.id, { cycleId: opsCycle.id });
    expect(other.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    await archiveCycle(cycles[2]!.id, owner.userId, new Date());
    const archived = await update(owner, issue.id, { cycleId: cycles[2]!.id });
    expect(archived.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
  });

  it('auto-assigns on start, on create in a started state, and between started states', async () => {
    const { owner, teamId, cycles, state, create } = await setup({ autoAssignStarted: true });
    const active = cycles[0]!.id;
    const moved = await create(state('unstarted'));
    const res = await update(owner, moved.id, { stateId: state('started') });
    expect(issueOf(res).cycle?.id).toBe(active);
    expect((await create(state('started'))).cycle?.id).toBe(active);
    const review = await createState(owner, { teamId, name: 'Review', type: 'started' });
    const between = await create(state('started'), { cycleId: null });
    expect(between.cycle).toBeNull();
    const again = await update(owner, between.id, { stateId: review.id });
    expect(issueOf(again).cycle?.id).toBe(active);
  });

  it('lets an explicit cycleId, including null, win over auto-assign', async () => {
    const { owner, cycles, state, create } = await setup({ autoAssignStarted: true });
    const issue = await create(state('unstarted'));
    const res = await update(owner, issue.id, {
      stateId: state('started'),
      cycleId: cycles[1]!.id,
    });
    expect(issueOf(res).cycle?.id).toBe(cycles[1]!.id);
    const other = await create(state('unstarted'));
    const kept = await update(owner, other.id, { stateId: state('started'), cycleId: null });
    expect(issueOf(kept).cycle).toBeNull();
  });

  it('auto-assigns completed issues only when that setting is on', async () => {
    const { owner, cycles, state, create } = await setup({ autoAssignCompleted: true });
    const started = await create(state('started'));
    expect(started.cycle).toBeNull();
    const done = await update(owner, started.id, { stateId: state('completed') });
    expect(issueOf(done).cycle?.id).toBe(cycles[0]!.id);
  });

  it('keeps a milestone set together with a project in one patch', async () => {
    const { owner, teamId, state, create } = await setup();
    const a = await createProject(owner, { name: 'A', teamIds: [teamId] });
    const b = await createProject(owner, { name: 'B', teamIds: [teamId] });
    const mb = await createMilestone(b.id, { name: 'Beta' });
    const issue = await create(state('unstarted'), { projectId: a.id });
    const res = await update(owner, issue.id, { projectId: b.id, projectMilestoneId: mb.id });
    expect(
      (res.body.data as { issueUpdate: { issue: { projectMilestone: { id: string } | null } } })
        .issueUpdate.issue.projectMilestone?.id,
    ).toBe(mb.id);
  });
});

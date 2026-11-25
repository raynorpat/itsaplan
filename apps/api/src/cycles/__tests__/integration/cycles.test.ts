import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { createCycle, listCycles } from '../../store';

// Team cycle settings (through teamUpdate) and the cycle store.

const SETTINGS = `cyclesEnabled cycleDuration cycleStartDay cycleCooldownTime upcomingCycleCount
  cycleIssueAutoAssignStarted cycleIssueAutoAssignCompleted`;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const view = await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, teamId: view.team.id };
}

function updateTeam(cookie: string, teamId: string, input: Record<string, unknown>) {
  return gql(
    { cookie },
    `mutation ($id: String!, $input: TeamUpdateInput!) {
      teamUpdate(id: $id, input: $input) { team { ${SETTINGS} } } }`,
    { id: teamId, input },
  );
}

describe('cycles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enabling cycles creates the current and two upcoming cycles', async () => {
    const { owner, teamId } = await setup();
    const res = await updateTeam(owner.cookie, teamId, { cyclesEnabled: true });
    expect(res.body.errors).toBeUndefined();
    expect((res.body.data as { teamUpdate: { team: unknown } }).teamUpdate.team).toMatchObject({
      cyclesEnabled: true,
      cycleDuration: 2,
      cycleStartDay: 1,
      cycleCooldownTime: 0,
      upcomingCycleCount: 2,
      cycleIssueAutoAssignStarted: false,
      cycleIssueAutoAssignCompleted: false,
    });
    const cycles = await listCycles(teamId);
    expect(cycles.map((c) => c.number)).toEqual([1, 2, 3]);
    const now = Date.now();
    expect(new Date(cycles[0]!.startsAt).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(cycles[0]!.endsAt).getTime()).toBeGreaterThan(now);
    for (let i = 1; i < cycles.length; i++) expect(cycles[i]!.startsAt).toBe(cycles[i - 1]!.endsAt);
  });

  it('rejects out-of-range settings', async () => {
    const { owner, teamId } = await setup();
    for (const input of [
      { cycleDuration: 9 },
      { cycleCooldownTime: 4 },
      { upcomingCycleCount: 11 },
      { cycleStartDay: 7 },
    ]) {
      const res = await updateTeam(owner.cookie, teamId, input);
      expect(res.body.errors?.[0]?.extensions?.code).toBe('INVALID_INPUT');
    }
  });

  it('rejects a cycle that overlaps another, and any cycle while cycles are off', async () => {
    const { owner, teamId } = await setup();
    const start = new Date('2030-01-07T00:00:00Z');
    const end = new Date('2030-01-21T00:00:00Z');
    await expect(
      createCycle(teamId, { startsAt: start, endsAt: end }, owner.userId),
    ).rejects.toMatchObject({ status: 400 });
    await gqlData(
      owner,
      `mutation ($id: String!) { teamUpdate(id: $id, input: { cyclesEnabled: true }) { success } }`,
      { id: teamId },
    );
    const made = await createCycle(teamId, { startsAt: start, endsAt: end }, owner.userId);
    expect(made.number).toBe(4);
    await expect(
      createCycle(
        teamId,
        { startsAt: new Date('2030-01-14T00:00:00Z'), endsAt: new Date('2030-01-28T00:00:00Z') },
        owner.userId,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

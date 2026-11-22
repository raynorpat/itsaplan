import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createCycle, listCycles } from '../../store';

// Team cycle settings and the cycle store.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  return { owner, asOwner, teamId: team.team.id };
}

describe('cycles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enabling cycles creates the current and two upcoming cycles', async () => {
    const { asOwner, teamId } = await setup();
    const res = await asOwner
      .teams({ teamKey: 'MKT' })
      .settings.patch({ cycles: { enabled: true } });
    expect(res.status).toBe(200);
    expect(res.data!.cycles).toMatchObject({
      enabled: true,
      duration: 2,
      startDay: 1,
      cooldown: 0,
      upcoming: 2,
      autoAssignStarted: false,
      autoAssignCompleted: false,
    });
    const cycles = await listCycles(teamId);
    expect(cycles.map((c) => c.number)).toEqual([1, 2, 3]);
    const now = Date.now();
    expect(new Date(cycles[0]!.startsAt).getTime()).toBeLessThanOrEqual(now);
    expect(new Date(cycles[0]!.endsAt).getTime()).toBeGreaterThan(now);
    for (let i = 1; i < cycles.length; i++) expect(cycles[i]!.startsAt).toBe(cycles[i - 1]!.endsAt);
  });

  it('rejects out-of-range settings', async () => {
    const { asOwner } = await setup();
    const scope = asOwner.teams({ teamKey: 'MKT' }).settings;
    for (const cycles of [{ duration: 9 }, { cooldown: 4 }, { upcoming: 11 }, { startDay: 7 }]) {
      expect((await scope.patch({ cycles })).status).toBe(400);
    }
  });

  it('rejects a cycle that overlaps another, and any cycle while cycles are off', async () => {
    const { owner, asOwner, teamId } = await setup();
    const start = new Date('2030-01-07T00:00:00Z');
    const end = new Date('2030-01-21T00:00:00Z');
    await expect(
      createCycle(teamId, { startsAt: start, endsAt: end }, owner.userId),
    ).rejects.toThrow();
    await asOwner.teams({ teamKey: 'MKT' }).settings.patch({ cycles: { enabled: true } });
    const made = await createCycle(teamId, { startsAt: start, endsAt: end }, owner.userId);
    expect(made.number).toBe(4);
    await expect(
      createCycle(
        teamId,
        { startsAt: new Date('2030-01-14T00:00:00Z'), endsAt: new Date('2030-01-28T00:00:00Z') },
        owner.userId,
      ),
    ).rejects.toThrow();
  });
});

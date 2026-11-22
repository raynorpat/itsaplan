import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { api, authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { updateIssue } from '../../../issues/store';
import { db, cycle } from '@repo/db';
import {
  closeCycle,
  getCycle,
  listCycles,
  recordHistory,
  runUpkeep,
  setTeamCycleSettings,
} from '../../store';

// Cycle upkeep: closing ended cycles with rollover into the current cycle,
// keeping upcoming cycles ahead, skipping ahead after a gap, and the daily
// history. Upkeep takes an explicit `now`; cycles are created around the real time.

const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'test-worker-token';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const state = (type: string) => team.states.find((s) => s.stateType === type)!.id;
  await setTeamCycleSettings(team.team.id, { enabled: true });
  const cycles = await listCycles(team.team.id);
  return { owner, asOwner, teamId: team.team.id, state, cycles };
}

async function issueIn(api: Api, stateId: string, cycleId: string) {
  const issue = (await api.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'x' })).data!;
  await updateIssue(issue.id, { cycleId });
  return issue;
}

describe('cycle upkeep', () => {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.WORKER_INTERNAL_TOKEN;
    process.env.WORKER_INTERNAL_TOKEN = TOKEN;
  });
  afterAll(() => {
    process.env.WORKER_INTERNAL_TOKEN = previous;
  });
  beforeEach(async () => {
    await resetDb();
  });

  it('closes an ended cycle and rolls only unfinished issues into the current one', async () => {
    const { asOwner, state, cycles } = await setup();
    const [first, second] = cycles;
    const started = await issueIn(asOwner, state('started'), first!.id);
    const done = await issueIn(asOwner, state('completed'), first!.id);
    const canceled = await issueIn(asOwner, state('canceled'), first!.id);
    const archived = await issueIn(asOwner, state('started'), first!.id);
    await asOwner.issues({ issueId: archived.id }).archive.post();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] })
    ).data!;

    await runUpkeep(new Date(new Date(second!.startsAt).getTime() + DAY));

    const closed = (await getCycle(first!.id))!;
    expect(closed.completedAt).toBe(closed.endsAt);
    expect(closed.uncompletedIssueIdsUponClose).toEqual([started.id]);
    const cycleOf = async (id: string) =>
      (await asOwner.issues({ issueId: id }).get()).data!.cycleId;
    expect(await cycleOf(started.id)).toBe(second!.id);
    expect(await cycleOf(done.id)).toBe(first!.id);
    expect(await cycleOf(canceled.id)).toBe(first!.id);
    expect(await cycleOf(archived.id)).toBe(first!.id);
    const feed = await asOwner.issues({ issueId: started.id }).feed.get();
    expect(feed.data!.items.some((i) => i.action === 'cycle')).toBe(true);
    const deliveries = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!
      .items;
    expect(
      deliveries.some(
        (d) =>
          (d.payload as { updatedFrom?: { cycleId?: string } }).updatedFrom?.cycleId === first!.id,
      ),
    ).toBe(true);
  });

  it('keeps the configured number of upcoming cycles', async () => {
    const { teamId, cycles } = await setup();
    await runUpkeep(new Date(new Date(cycles[1]!.startsAt).getTime() + DAY));
    const now = new Date(cycles[1]!.startsAt).getTime() + DAY;
    const after = await listCycles(teamId);
    expect(after.filter((c) => new Date(c.startsAt).getTime() > now)).toHaveLength(2);
  });

  it('skips ahead after a long gap without creating past cycles', async () => {
    const { asOwner, teamId, state, cycles } = await setup();
    const last = cycles[cycles.length - 1]!;
    const stuck = await issueIn(asOwner, state('started'), cycles[0]!.id);
    const now = new Date(new Date(last.endsAt).getTime() + 10 * 7 * DAY);
    await runUpkeep(now);
    const after = await listCycles(teamId);
    const current = after.find((c) => new Date(c.startsAt) <= now && new Date(c.endsAt) > now)!;
    expect(current).toBeDefined();
    // No cycle lies entirely between the old last cycle and the new current one.
    expect(
      after.filter(
        (c) =>
          new Date(c.startsAt) >= new Date(last.endsAt) &&
          new Date(c.endsAt) <= new Date(current.startsAt),
      ),
    ).toEqual([]);
    expect((await asOwner.issues({ issueId: stuck.id }).get()).data!.cycleId).toBe(current.id);
    for (const old of cycles) expect((await getCycle(old.id))!.completedAt).toBeTruthy();
  });

  it('re-enabling creates no overlap and closes cycles that ended while disabled', async () => {
    const { teamId, cycles } = await setup();
    await setTeamCycleSettings(teamId, { enabled: false });
    const later = new Date(new Date(cycles[1]!.endsAt).getTime() + DAY);
    await setTeamCycleSettings(teamId, { enabled: true });
    await runUpkeep(later);
    const after = await listCycles(teamId);
    for (let i = 1; i < after.length; i++)
      expect(new Date(after[i]!.startsAt) >= new Date(after[i - 1]!.endsAt)).toBe(true);
    expect((await getCycle(cycles[0]!.id))!.completedAt).toBeTruthy();
    expect((await getCycle(cycles[1]!.id))!.completedAt).toBeTruthy();
  });

  it('appends one history entry per day and catches up missed days', async () => {
    const { asOwner, teamId, state, cycles } = await setup();
    const current = cycles[0]!;
    await issueIn(asOwner, state('completed'), current.id);
    await issueIn(asOwner, state('started'), current.id);
    const start = new Date(current.startsAt).getTime();
    await recordHistory(teamId, new Date(start + 0.5 * DAY));
    expect((await getCycle(current.id))!.issueCountHistory).toEqual([2]);
    await recordHistory(teamId, new Date(start + 3.5 * DAY));
    const c = (await getCycle(current.id))!;
    expect(c.issueCountHistory).toEqual([2, 2, 2, 2]);
    expect(c.completedIssueCountHistory).toEqual([1, 1, 1, 1]);
  });

  it('needs the worker token on the internal route', async () => {
    const res = await api.internal.cycles.tick.post();
    expect(res.status).toBe(401);
    const ok = await api.internal.cycles.tick.post(undefined, {
      headers: { 'x-worker-token': TOKEN },
    });
    expect(ok.status).toBe(200);
  });

  it('moves unfinished issues after a gap even when the start day changed', async () => {
    const { asOwner, teamId, state, cycles } = await setup();
    const stuck = await issueIn(asOwner, state('started'), cycles[0]!.id);
    await setTeamCycleSettings(teamId, { startDay: 3 });
    const now = new Date(new Date(cycles[2]!.endsAt).getTime() + DAY);
    await runUpkeep(now);
    const moved = (await asOwner.issues({ issueId: stuck.id }).get()).data!.cycleId;
    const target = (await getCycle(moved!))!;
    expect(target.completedAt).toBeNull();
  });

  it("keeps upkeep going for other teams when one team's upkeep fails", async () => {
    const { teamId: brokenTeam, cycles: broken } = await setup();
    // A long cycle that ends after the latest one makes the next cycle overlap it.
    await db.insert(cycle).values({
      teamId: brokenTeam,
      number: 99,
      startsAt: new Date(new Date(broken[0]!.startsAt).getTime() - DAY),
      endsAt: new Date(new Date(broken[2]!.endsAt).getTime() + 100 * DAY),
    });
    const other = await signUpTestUser({ name: 'Other' });
    const asOther = authedApi(other.cookie);
    await asOther.teams.post({ key: 'OPS', name: 'Operations' });
    const ops = (await asOther.teams({ teamKey: 'OPS' }).get()).data!;
    await setTeamCycleSettings(ops.team.id, { enabled: true });
    const opsCycles = await listCycles(ops.team.id);
    await runUpkeep(new Date(new Date(opsCycles[0]!.endsAt).getTime() + DAY));
    expect((await getCycle(opsCycles[0]!.id))!.completedAt).toBeTruthy();
  });

  it('does not close a cycle twice', async () => {
    const { owner, asOwner, state, cycles } = await setup();
    const started = await issueIn(asOwner, state('started'), cycles[0]!.id);
    const now = new Date(new Date(cycles[1]!.startsAt).getTime() + DAY);
    await closeCycle(cycles[0]!.id, new Date(cycles[0]!.endsAt), now, owner.userId);
    await closeCycle(cycles[0]!.id, new Date(cycles[0]!.endsAt), now, owner.userId);
    expect((await getCycle(cycles[0]!.id))!.uncompletedIssueIdsUponClose).toEqual([started.id]);
  });
});

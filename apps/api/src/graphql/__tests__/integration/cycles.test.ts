import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import { listCycles } from '../../../cycles/store';

// Cycles over the Linear API: team settings through teamUpdate, cycle CRUD,
// closing by hand, archiving, progress, flags, the issue cycle filter, webhooks.

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const DAY = 24 * 60 * 60 * 1000;

async function setup(enable = true) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const team = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!;
  const client = linearClient(await createApiKey(owner.cookie));
  if (enable) await client.updateTeam(team.team.id, { cyclesEnabled: true });
  const state = (type: string) => team.states.find((s) => s.stateType === type)!.id;
  return { owner, asOwner, teamId: team.team.id, client, state };
}

describe('graphql cycles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('enables cycles through teamUpdate and reads them back', async () => {
    const { owner, asOwner, teamId, client } = await setup(false);
    const updated = await (
      await client.updateTeam(teamId, { cyclesEnabled: true, cycleDuration: 1 })
    ).team;
    expect(updated).toMatchObject({ cyclesEnabled: true, cycleDuration: 1, upcomingCycleCount: 2 });
    const team = await client.team(teamId);
    expect((await team.activeCycle)?.number).toBe(1);
    expect((await team.cycles()).nodes).toHaveLength(3);
    const bad = await gql(
      { cookie: owner.cookie },
      `mutation { teamUpdate(id: "${teamId}", input: { timezone: "UTC" }) { success } }`,
    );
    expect(errorCode(bad)).toBe('INVALID_INPUT');
    expect(bad.body.errors?.[0]?.message).toContain('timezone');
    const member = await signUpTestUser();
    const invite = await asOwner
      .teams({ teamKey: 'MKT' })
      .invites.post({ email: member.email, role: 'member' });
    await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();
    const denied = await gql(
      { cookie: member.cookie },
      `mutation { teamUpdate(id: "${teamId}", input: { cycleDuration: 3 }) { success } }`,
    );
    expect(errorCode(denied)).toBe('FORBIDDEN');
  });

  it('creates a cycle after the last one, rejects an overlap, and renames', async () => {
    const { owner, teamId, client } = await setup();
    const last = (await listCycles(teamId)).at(-1)!;
    const startsAt = new Date(new Date(last.endsAt).getTime() + 7 * DAY);
    const created = (await (
      await client.createCycle({
        teamId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 7 * DAY),
        name: 'Hardening',
      })
    ).cycle)!;
    expect(created).toMatchObject({ number: 4, name: 'Hardening' });
    const overlap = await gql(
      { cookie: owner.cookie },
      `mutation { cycleCreate(input: { teamId: "${teamId}", startsAt: "${startsAt.toISOString()}", endsAt: "${new Date(startsAt.getTime() + DAY).toISOString()}" }) { success } }`,
    );
    expect(errorCode(overlap)).toBe('INVALID_INPUT');
    const renamed = await (await client.updateCycle(created.id, { name: 'Polish' })).cycle;
    expect(renamed?.name).toBe('Polish');
  });

  it('closes the active cycle by hand and rolls its unfinished issues forward', async () => {
    const { owner, teamId, client, state } = await setup();
    const [active, next] = await listCycles(teamId);
    const open = (await (
      await client.createIssue({
        teamId,
        title: 'open',
        stateId: state('started'),
        cycleId: active!.id,
      })
    ).issue)!;
    const closedAt = new Date();
    const closed = (await (await client.updateCycle(active!.id, { completedAt: closedAt })).cycle)!;
    expect(closed.completedAt).toBeTruthy();
    expect(new Date(closed.endsAt).getTime()).toBe(new Date(closed.completedAt!).getTime());
    expect((await (await client.issue(open.id)).cycle)?.id).not.toBe(active!.id);
    const future = await gql(
      { cookie: owner.cookie },
      `mutation { cycleUpdate(id: "${next!.id}", input: { completedAt: "${new Date().toISOString()}" }) { success } }`,
    );
    expect(errorCode(future)).toBe('INVALID_INPUT');
  });

  it('archives a future cycle and refuses to archive the active one', async () => {
    const { owner, teamId, client, state } = await setup();
    const [active, , future] = await listCycles(teamId);
    const issue = (await (
      await client.createIssue({
        teamId,
        title: 'later',
        stateId: state('unstarted'),
        cycleId: future!.id,
      })
    ).issue)!;
    const denied = await gql(
      { cookie: owner.cookie },
      `mutation { cycleArchive(id: "${active!.id}") { success } }`,
    );
    expect(errorCode(denied)).toBe('INVALID_INPUT');
    expect((await client.archiveCycle(future!.id)).success).toBe(true);
    expect(await (await client.issue(issue.id)).cycle).toBeUndefined();
  });

  it("follows Linear's progress formula", async () => {
    const { teamId, client, state } = await setup();
    const [active] = await listCycles(teamId);
    const make = (stateType: string, estimate?: number) =>
      client.createIssue({
        teamId,
        title: stateType,
        stateId: state(stateType),
        cycleId: active!.id,
        ...(estimate !== undefined ? { estimate } : {}),
      });
    await make('completed');
    await make('completed');
    await make('started');
    await make('started');
    await make('canceled');
    expect((await client.cycle(active!.id)).progress).toBeCloseTo(0.625);

    const [, second] = await listCycles(teamId);
    await client.createIssue({
      teamId,
      title: 'a',
      stateId: state('completed'),
      cycleId: second!.id,
      estimate: 3,
    });
    await client.createIssue({
      teamId,
      title: 'b',
      stateId: state('started'),
      cycleId: second!.id,
    });
    expect((await client.cycle(second!.id)).progress).toBeCloseTo(0.8125);
  });

  it('filters issues by cycle and reads the cycle flags', async () => {
    const { owner, teamId, client, state } = await setup();
    const [active, next, after] = await listCycles(teamId);
    const inCycle = (await (
      await client.createIssue({
        teamId,
        title: 'in',
        stateId: state('unstarted'),
        cycleId: active!.id,
      })
    ).issue)!;
    await client.createIssue({ teamId, title: 'out', stateId: state('unstarted') });
    const byId = await gql(
      { cookie: owner.cookie },
      `{ issues(filter: { cycle: { id: { eq: "${active!.id}" } } }) { nodes { id } } }`,
    );
    expect(byId.body.data).toEqual({ issues: { nodes: [{ id: inCycle.id }] } });
    const none = await gql(
      { cookie: owner.cookie },
      '{ issues(filter: { cycle: { null: true } }) { nodes { title } } }',
    );
    expect(none.body.data).toEqual({ issues: { nodes: [{ title: 'out' }] } });
    const flags = async (id: string) => {
      const c = await client.cycle(id);
      return [c.isActive, c.isNext, c.isFuture, c.isPast];
    };
    expect(await flags(active!.id)).toEqual([true, false, false, false]);
    expect(await flags(next!.id)).toEqual([false, true, true, false]);
    expect(await flags(after!.id)).toEqual([false, false, true, false]);
  });

  it('sends a Cycle webhook on cycleCreate', async () => {
    const { asOwner, teamId, client } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Cycle'] })
    ).data!;
    const last = (await listCycles(teamId)).at(-1)!;
    const startsAt = new Date(new Date(last.endsAt).getTime() + 7 * DAY);
    await client.createCycle({ teamId, startsAt, endsAt: new Date(startsAt.getTime() + DAY) });
    const items = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!.items;
    expect(items.map((d) => (d.payload as { action: string; type: string }).type)).toContain(
      'Cycle',
    );
  });

  it('rejects a completedAt before the start and a cleared completedAt', async () => {
    const { owner, teamId } = await setup();
    const [active] = await listCycles(teamId);
    const early = new Date(new Date(active!.startsAt).getTime() - DAY).toISOString();
    for (const value of [`"${early}"`, 'null']) {
      const res = await gql(
        { cookie: owner.cookie },
        `mutation { cycleUpdate(id: "${active!.id}", input: { completedAt: ${value} }) { success } }`,
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
    }
  });

  it("names the close snapshot like Linear's Cycle webhook payload", async () => {
    const { asOwner, teamId, client } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Cycle'] })
    ).data!;
    const [active] = await listCycles(teamId);
    await client.updateCycle(active!.id, { completedAt: new Date() });
    const data = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!.items.map(
      (d) => (d.payload as { data: Record<string, unknown> }).data,
    );
    expect(data.some((d) => 'uncompletedIssuesUponCloseIds' in d)).toBe(true);
    expect(data.some((d) => 'uncompletedIssueIdsUponClose' in d)).toBe(false);
  });

  it('validates teamUpdate before writing anything', async () => {
    const { owner, asOwner, teamId } = await setup();
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { teamUpdate(id: "${teamId}", input: { name: "Renamed", cycleDuration: 99 }) { success } }`,
    );
    expect(errorCode(res)).toBe('INVALID_INPUT');
    expect((await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.name).toBe('Marketing');
    for (const name of ['""', 'null']) {
      const bad = await gql(
        { cookie: owner.cookie },
        `mutation { teamUpdate(id: "${teamId}", input: { name: ${name} }) { success } }`,
      );
      expect(errorCode(bad)).toBe('INVALID_INPUT');
    }
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { db, initiative } from '@repo/db';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import {
  addMember,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { resetDb } from '../../../__tests__/helpers/db';
import { assertInitiativeAccess, assertLeadTeamMember, visibleInitiativesSql } from '../../access';
import {
  archiveInitiative,
  createInitiative,
  getInitiative,
  unarchiveInitiative,
  updateInitiative,
} from '../../store';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';

// Initiatives: defaults, status timestamps, archive / trash, visibility by lead
// team, owner rules and webhooks.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = owner;
  await createTeam(asOwner, { key: 'MKT', name: 'Marketing' });
  await createTeam(asOwner, { key: 'OPS', name: 'Operations' });
  const teamId = async (key: string) => (await teamView(asOwner, key)).team.id;
  return { owner, asOwner, mkt: await teamId('MKT'), ops: await teamId('OPS') };
}

async function memberOf(owner: TestUser, teamKey: string) {
  const user = await signUpTestUser();
  await addMember(owner, teamKey, user.userId);
  return { user };
}

async function visibleIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: initiative.id })
    .from(initiative)
    .where(await visibleInitiativesSql(userId));
  return rows.map((r) => r.id);
}

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

describe('initiatives', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates with Linear's defaults", async () => {
    const { owner } = await setup();
    const created = await createInitiative({ name: 'Q1 goals' }, owner.userId);
    expect(created).toMatchObject({
      name: 'Q1 goals',
      status: 'Active',
      priority: 0,
      completedAt: null,
      creatorUserId: owner.userId,
      leadTeamId: null,
      trashed: null,
    });
    expect(created.startedAt).toBeTruthy();
    expect(created.slugId).toMatch(/^[0-9a-f]{12}$/);
    expect((await getInitiative(created.slugId))?.id).toBe(created.id);
  });

  it('sets and clears the status timestamps', async () => {
    const { owner } = await setup();
    const created = await createInitiative({ name: 'A' }, owner.userId);
    const done = (await updateInitiative(created.id, { status: 'Completed' }, owner.userId))!;
    expect(done.completedAt).toBeTruthy();
    const planned = (await updateInitiative(created.id, { status: 'Planned' }, owner.userId))!;
    expect(planned.completedAt).toBeNull();
    expect(planned.startedAt).toBe(created.startedAt);
    await Bun.sleep(5);
    const active = (await updateInitiative(created.id, { status: 'Active' }, owner.userId))!;
    expect(new Date(active.startedAt!).getTime()).toBeGreaterThan(
      new Date(created.startedAt!).getTime(),
    );
    const proposed = await createInitiative({ name: 'B', status: 'Proposed' }, owner.userId);
    expect(proposed.startedAt).toBeNull();
  });

  it('archives, deletes to the trash and unarchives', async () => {
    const { owner } = await setup();
    const created = await createInitiative({ name: 'A' }, owner.userId);
    const archived = await archiveInitiative(created.id, owner.userId);
    expect(archived.archivedAt).toBeTruthy();
    expect(archived.trashed).toBeNull();
    const trashed = await archiveInitiative(created.id, owner.userId, { trash: true });
    expect(trashed.trashed).toBe(true);
    const restored = await unarchiveInitiative(created.id, owner.userId);
    expect(restored).toMatchObject({ archivedAt: null, trashed: null });
  });

  it('limits a lead-team initiative to that team', async () => {
    const { owner, asOwner, mkt } = await setup();
    await makePrivate(asOwner, 'MKT');
    const workspace = await createInitiative({ name: 'W' }, owner.userId);
    const led = await createInitiative({ name: 'L', leadTeamId: mkt }, owner.userId);
    const opsMember = await memberOf(asOwner, 'OPS');
    expect(await visibleIds(opsMember.user.userId)).toEqual([workspace.id]);
    expect(await status(assertInitiativeAccess(led.id, opsMember.user.userId))).toBe(404);
    expect((await assertInitiativeAccess(workspace.id, opsMember.user.userId)).id).toBe(
      workspace.id,
    );
    const mktMember = await memberOf(asOwner, 'MKT');
    expect((await assertInitiativeAccess(led.id, mktMember.user.userId)).id).toBe(led.id);
    const guest = await signUpAs('guest');
    expect(await visibleIds(guest.userId)).toEqual([]);
  });

  it('keeps the owner able to see the initiative', async () => {
    const { owner, asOwner, mkt, ops } = await setup();
    await makePrivate(asOwner, 'MKT');
    const opsMember = await memberOf(asOwner, 'OPS');
    expect(
      await status(
        createInitiative(
          { name: 'A', leadTeamId: mkt, ownerId: opsMember.user.userId },
          owner.userId,
        ),
      ),
    ).toBe(400);
    const created = await createInitiative(
      { name: 'A', leadTeamId: ops, ownerId: opsMember.user.userId },
      owner.userId,
    );
    expect(await status(updateInitiative(created.id, { leadTeamId: mkt }, owner.userId))).toBe(400);
    const moved = await updateInitiative(
      created.id,
      { leadTeamId: mkt, ownerId: owner.userId },
      owner.userId,
    );
    expect(moved).toMatchObject({ leadTeamId: mkt, ownerUserId: owner.userId });
    expect(await status(assertLeadTeamMember(opsMember.user.userId, mkt))).toBe(404);
  });

  it('turns initiatives of a deleted team into workspace initiatives', async () => {
    const { owner, asOwner, mkt } = await setup();
    await makePrivate(asOwner, 'MKT');
    const led = await createInitiative({ name: 'L', leadTeamId: mkt }, owner.userId);
    const opsMember = await memberOf(asOwner, 'OPS');
    expect(await visibleIds(opsMember.user.userId)).toEqual([]);
    await gqlData(asOwner, `mutation ($id: String!) { teamDelete(id: $id) { success } }`, {
      id: mkt,
    });
    expect(await visibleIds(opsMember.user.userId)).toEqual([led.id]);
  });

  it('sends Initiative webhooks to the lead team', async () => {
    const { owner, asOwner, mkt } = await setup();
    const hook = await createWebhook(asOwner, {
      url: 'https://example.com/h',
      resourceTypes: ['Initiative'],
      teamId: 'MKT',
    });
    const created = await createInitiative({ name: 'A', leadTeamId: mkt }, owner.userId);
    await updateInitiative(created.id, { name: 'B' }, owner.userId);
    await archiveInitiative(created.id, owner.userId);
    const payloads = (await webhookDeliveries(hook.id))
      .data!.items.map(
        (d) =>
          d.payload as {
            action: string;
            type: string;
            data: { id: string; projects: unknown[] };
            updatedFrom?: { name?: string };
          },
      )
      .reverse();
    expect(payloads.map((p) => [p.type, p.action])).toEqual([
      ['Initiative', 'create'],
      ['Initiative', 'update'],
      ['Initiative', 'remove'],
    ]);
    expect(payloads[1]!.updatedFrom?.name).toBe('A');
    expect(payloads[0]!.data).toMatchObject({ id: created.id, projects: [], leadTeamId: mkt });
  });

  it('rejects an empty name and an out-of-range priority', async () => {
    const { owner } = await setup();
    expect(await status(createInitiative({ name: '  ' }, owner.userId))).toBe(400);
    expect(await status(createInitiative({ name: 'A', priority: 5 }, owner.userId))).toBe(400);
  });

  it('bumps updatedAt on archive and keeps the first archivedAt', async () => {
    const { owner } = await setup();
    const created = await createInitiative({ name: 'A' }, owner.userId);
    await Bun.sleep(5);
    const archived = await archiveInitiative(created.id, owner.userId);
    expect(new Date(archived.updatedAt).getTime()).toBeGreaterThan(
      new Date(created.updatedAt).getTime(),
    );
    await Bun.sleep(5);
    const again = await archiveInitiative(created.id, owner.userId, { trash: true });
    expect(again.archivedAt).toBe(archived.archivedAt);
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { assertParentAccess, createComment } from '../../../comments/store';
import { assertReactionParentAccess, createReaction } from '../../../reactions/store';
import { createInitiative } from '../../store';
import {
  createInitiativeUpdate,
  latestInitiativeUpdate,
  setInitiativeUpdateArchived,
  updateInitiativeUpdate,
} from '../../updates';

// Initiative updates: health from the newest update, edits, archive, comments and
// reactions on an update, and the InitiativeUpdate webhooks.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  const mkt = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.team.id;
  return { owner, asOwner, mkt };
}

const status = (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e: { status?: number }) => e.status,
  );

describe('initiative updates', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('takes health from the newest update that is not archived', async () => {
    const { owner } = await setup();
    const a = await createInitiative({ name: 'A' }, owner.userId);
    expect(await latestInitiativeUpdate(a.id)).toBeNull();
    await createInitiativeUpdate(a.id, owner.userId, { body: 'meh', health: 'atRisk' });
    await Bun.sleep(5);
    const bad = await createInitiativeUpdate(a.id, owner.userId, {
      body: 'bad',
      health: 'offTrack',
    });
    expect((await latestInitiativeUpdate(a.id))?.health).toBe('offTrack');
    await setInitiativeUpdateArchived(bad.id, true, owner.userId);
    expect((await latestInitiativeUpdate(a.id))?.health).toBe('atRisk');
  });

  it('defaults health to onTrack and marks edits', async () => {
    const { owner } = await setup();
    const a = await createInitiative({ name: 'A' }, owner.userId);
    const posted = await createInitiativeUpdate(a.id, owner.userId, { body: 'ok' });
    expect(posted).toMatchObject({ health: 'onTrack', editedAt: null, archivedAt: null });
    const edited = await updateInitiativeUpdate(posted.id, { body: 'fine' }, owner.userId);
    expect(edited).toMatchObject({ body: 'fine' });
    expect(edited.editedAt).toBeTruthy();
  });

  it('takes comments and reactions, visible through the initiative', async () => {
    const { owner, asOwner, mkt } = await setup();
    const a = await createInitiative({ name: 'A', leadTeamId: mkt }, owner.userId);
    const posted = await createInitiativeUpdate(a.id, owner.userId, { body: 'ok' });
    const parent = { initiativeUpdateId: posted.id };
    const c = await createComment({ parent, body: 'nice', actorUserId: owner.userId });
    expect(c.initiativeUpdateId).toBe(posted.id);
    const r = await createReaction({ parent, emoji: '👍', userId: owner.userId });
    expect(r.initiativeUpdateId).toBe(posted.id);
    const outsider = await signUpWithRole('guest');
    const invite = await asOwner
      .teams({ teamKey: 'OPS' })
      .invites.post({ email: outsider.email, role: 'member' });
    await authedApi(outsider.cookie).invites({ token: invite.data!.token }).accept.post();
    const user = { id: outsider.userId } as Parameters<typeof assertParentAccess>[1];
    expect(await status(assertParentAccess(parent, user))).toBe(404);
    expect(await status(assertReactionParentAccess(parent, user))).toBe(404);
    const ownerUser = { id: owner.userId } as Parameters<typeof assertParentAccess>[1];
    expect(await status(assertParentAccess(parent, ownerUser))).toBe(200);
  });

  it('sends InitiativeUpdate webhooks', async () => {
    const { owner, asOwner, mkt } = await setup();
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['InitiativeUpdate'] })
    ).data!;
    const a = await createInitiative({ name: 'A', leadTeamId: mkt }, owner.userId);
    const posted = await createInitiativeUpdate(a.id, owner.userId, { body: 'ok' });
    await updateInitiativeUpdate(posted.id, { health: 'atRisk' }, owner.userId);
    await setInitiativeUpdateArchived(posted.id, true, owner.userId);
    const payloads = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get())
      .data!.items.map(
        (d) => d.payload as { action: string; type: string; data: { initiativeId: string } },
      )
      .reverse();
    expect(payloads.map((p) => [p.type, p.action])).toEqual([
      ['InitiativeUpdate', 'create'],
      ['InitiativeUpdate', 'update'],
      ['InitiativeUpdate', 'remove'],
    ]);
    expect(payloads[0]!.data.initiativeId).toBe(a.id);
  });

  it('sends an Initiative update when a new update changes the health', async () => {
    const { owner, asOwner, mkt } = await setup();
    const a = await createInitiative({ name: 'A', leadTeamId: mkt }, owner.userId);
    const hook = (
      await asOwner
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Initiative'] })
    ).data!;
    await createInitiativeUpdate(a.id, owner.userId, { body: 'meh', health: 'atRisk' });
    const payloads = (
      await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()
    ).data!.items.map(
      (d) =>
        d.payload as { action: string; data: { health: string }; updatedFrom?: { health?: null } },
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ action: 'update', data: { health: 'atRisk' } });
    expect(payloads[0]!.updatedFrom).toHaveProperty('health', null);
  });
});

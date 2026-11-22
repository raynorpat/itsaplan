import { beforeEach, describe, expect, it } from 'bun:test';
import { api, authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey } from '../../../__tests__/helpers/linear';
import { makePrivate, signUpWithRole } from '../../../__tests__/helpers/roles';
import { workspaceRole } from '../../../shared/access';

// Joining teams, workspace role changes, suspension, and all-teams webhooks that
// skip private teams.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  await asOwner.teams.post({ key: 'SEC', name: 'Secret' });
  await makePrivate(asOwner, 'SEC');
  return { owner, asOwner };
}

describe('roles administration', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('anyone but a guest can join a public team', async () => {
    const { asOwner } = await setup();
    const member = await signUpWithRole('member');
    expect((await member.api.teams({ teamKey: 'MKT' }).join.post()).status).toBe(201);
    const members = (await asOwner.teams({ teamKey: 'MKT' }).members.get()).data!;
    expect(members.map((m) => m.userId)).toContain(member.userId);
    const guest = await signUpWithRole('guest');
    expect((await guest.api.teams({ teamKey: 'MKT' }).join.post()).status).toBe(404);
    expect((await member.api.teams({ teamKey: 'SEC' }).join.post()).status).toBe(404);
  });

  it('role changes follow the table and keep an owner', async () => {
    const { owner, asOwner } = await setup();
    const admin = await signUpWithRole('admin');
    const other = await signUpWithRole('admin');
    const member = await signUpWithRole('member');
    const users = (id: string) => admin.api.workspace.users({ userId: id });
    expect((await users(member.userId).patch({ role: 'guest' })).status).toBe(200);
    expect(await workspaceRole(member.userId)).toBe('guest');
    expect((await users(other.userId).patch({ role: 'member' })).status).toBe(403);
    expect((await users(member.userId).patch({ role: 'owner' })).status).toBe(403);
    const self = asOwner.workspace.users({ userId: owner.userId });
    expect((await self.patch({ role: 'admin' })).status).toBe(400);
    expect((await self.suspend.post()).status).toBe(400);
  });

  it('a suspended user cannot sign in or use an API key', async () => {
    const { asOwner } = await setup();
    const member = await signUpWithRole('member', { email: 'sus@example.com' });
    const key = await createApiKey(member.cookie);
    expect((await asOwner.workspace.users({ userId: member.userId }).suspend.post()).status).toBe(
      204,
    );
    // Signing in again (by magic link) is refused while suspended.
    expect(
      await signUpTestUser({ email: 'sus@example.com' }).then(
        () => 'signed in',
        () => 'refused',
      ),
    ).toBe('refused');
    expect((await api.teams.get({ headers: { 'x-api-key': key } })).status).toBe(401);
    expect((await authedApi(member.cookie).teams.get()).status).toBe(401);
    expect((await asOwner.workspace.users({ userId: member.userId }).unsuspend.post()).status).toBe(
      204,
    );
    expect((await api.teams.get({ headers: { 'x-api-key': key } })).status).toBe(200);
  });

  it('all-teams webhooks skip private teams', async () => {
    const { asOwner } = await setup();
    const hook = (
      await asOwner.webhooks.post({ url: 'https://example.com/all', resourceTypes: ['Issue'] })
    ).data!;
    for (const teamKey of ['SEC', 'MKT']) {
      const stateId = (await asOwner.teams({ teamKey }).get()).data!.states[0]!.id;
      await asOwner.teams({ teamKey }).issues.post({ stateId, title: teamKey });
    }
    const items = (await asOwner.webhooks({ webhookId: hook.id }).deliveries.get()).data!.items;
    const titles = items.map((d) => (d.payload as { data: { title: string } }).data.title);
    expect(titles).toEqual(['MKT']);
  });

  it('a suspended user receives no notifications', async () => {
    const { asOwner } = await setup();
    const member = await signUpWithRole('member');
    await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: member.userId });
    await asOwner.workspace.users({ userId: member.userId }).suspend.post();
    const stateId = (await asOwner.teams({ teamKey: 'MKT' }).get()).data!.states[0]!.id;
    await asOwner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId, title: 'T', assigneeUserId: member.userId });
    await asOwner.workspace.users({ userId: member.userId }).unsuspend.post();
    const { cookie } = await signUpTestUser({ email: member.email });
    const inbox = (await authedApi(cookie).notifications.get({ query: {} })).data!;
    expect(inbox.items).toHaveLength(0);
  });

  it('admins and owners can add themselves to a private team', async () => {
    await setup();
    const admin = await signUpWithRole('admin');
    const member = await signUpWithRole('member');
    const guest = await signUpWithRole('guest');
    expect((await member.api.teams({ teamKey: 'SEC' }).join.post()).status).toBe(404);
    expect((await guest.api.teams({ teamKey: 'SEC' }).join.post()).status).toBe(404);
    expect((await admin.api.teams({ teamKey: 'SEC' }).join.post()).status).toBe(201);
    expect((await admin.api.teams({ teamKey: 'SEC' }).get()).status).toBe(200);
    const other = await signUpWithRole('admin');
    const added = await other.api.teams({ teamKey: 'SEC' }).members.post({ userId: other.userId });
    expect(added.status).toBe(201);
  });
});

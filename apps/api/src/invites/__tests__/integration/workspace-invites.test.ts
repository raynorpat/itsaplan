import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { workspaceRole } from '../../../shared/access';
import { setAuthSettings } from '@repo/auth';

// Workspace invites: an invite carries a role and teams, applied when the invited
// address signs up; nobody invites above their own role; an existing account cannot
// be invited.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'OPS', name: 'Operations' });
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  const ops = (await asOwner.teams({ teamKey: 'OPS' }).get()).data!.team.id;
  return { owner, asOwner, ops };
}

describe('workspace invites', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('an invite applies its role and teams at sign-up', async () => {
    const { asOwner, ops } = await setup();
    const admin = await signUpWithRole('admin');
    const created = await admin.api.invites.post({
      email: 'guest@example.com',
      role: 'guest',
      teamIds: [ops],
    });
    expect(created.status).toBe(201);
    const guest = await signUpTestUser({
      email: 'guest@example.com',
      inviteToken: created.data!.token!,
    });
    expect(await workspaceRole(guest.userId)).toBe('guest');
    const teams = (await authedApi(guest.cookie).teams.get()).data!;
    expect(teams.map((t) => t.key)).toEqual(['OPS']);
    expect((await asOwner.invites.get()).data!.map((i) => i.email)).not.toContain(
      'guest@example.com',
    );
  });

  it("invites cannot exceed the inviter's role", async () => {
    await setup();
    const member = await signUpWithRole('member');
    const admin = await signUpWithRole('admin');
    expect((await member.api.invites.post({ email: 'a@example.com', role: 'admin' })).status).toBe(
      403,
    );
    expect(
      (await admin.api.invites.post({ email: 'b@example.com', role: 'owner' as never })).status,
    ).toBeGreaterThanOrEqual(400);
    expect((await member.api.invites.post({ email: 'c@example.com', role: 'guest' })).status).toBe(
      201,
    );
    const guest = await signUpWithRole('guest');
    expect((await guest.api.invites.post({ email: 'd@example.com', role: 'guest' })).status).toBe(
      403,
    );
  });

  it('inviting an existing account is refused', async () => {
    const { asOwner } = await setup();
    const existing = await signUpTestUser();
    expect((await asOwner.invites.post({ email: existing.email, role: 'member' })).status).toBe(
      400,
    );
  });

  it('applies an invite only with its token', async () => {
    const { asOwner, ops } = await setup();
    const created = await asOwner.invites.post({
      email: 'taken@example.com',
      role: 'admin',
      teamIds: [ops],
    });
    const other = await asOwner.invites.post({ email: 'other@example.com', role: 'admin' });
    // No token: a plain member with no teams, and the invite stays pending.
    const noToken = await signUpTestUser({ email: 'taken@example.com' });
    expect(await workspaceRole(noToken.userId)).toBe('member');
    expect((await authedApi(noToken.cookie).teams.get()).data!.filter((t) => t.role)).toEqual([]);
    expect((await asOwner.invites.get()).data!.map((i) => i.email)).toContain('taken@example.com');
    // Another invite's token does not apply to this address.
    const wrong = await signUpTestUser({
      email: 'third@example.com',
      inviteToken: other.data!.token!,
    });
    expect(await workspaceRole(wrong.userId)).toBe('member');
    expect(created.status).toBe(201);
  });

  it('invite-only registration needs the token', async () => {
    const { asOwner } = await setup();
    const created = await asOwner.invites.post({ email: 'inv@example.com', role: 'member' });
    await setAuthSettings({ registration: 'invite' });
    try {
      expect(
        await signUpTestUser({ email: 'inv@example.com' }).then(
          () => 'ok',
          () => 'refused',
        ),
      ).toBe('refused');
      const ok = await signUpTestUser({
        email: 'inv@example.com',
        inviteToken: created.data!.token!,
      });
      expect(ok.userId).toBeTruthy();
    } finally {
      await setAuthSettings({ registration: 'open' });
    }
  });

  it('shows invite tokens only to the sender and admins', async () => {
    await setup();
    const sender = await signUpWithRole('member');
    await sender.api.invites.post({ email: 'x@example.com', role: 'guest' });
    const bystander = await signUpWithRole('member');
    const admin = await signUpWithRole('admin');
    const tokenOf = async (api: typeof sender.api) =>
      (await api.invites.get()).data!.find((i) => i.email === 'x@example.com')!.token;
    expect(await tokenOf(bystander.api)).toBeNull();
    expect(await tokenOf(sender.api)).toBeTruthy();
    expect(await tokenOf(admin.api)).toBeTruthy();
  });
});

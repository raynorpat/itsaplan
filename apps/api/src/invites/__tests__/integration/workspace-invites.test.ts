import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';
import { workspaceRole } from '../../../shared/access';

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
    const guest = await signUpTestUser({ email: 'guest@example.com' });
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
});

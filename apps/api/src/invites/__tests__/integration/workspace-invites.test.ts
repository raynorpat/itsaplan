import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { workspaceRole } from '../../../shared/access';

// Workspace invites (organizationInviteCreate): an invite carries a role and teams,
// applied when the invited address signs up; nobody invites above their own role; an
// existing account cannot be invited. Token visibility is in the invite-metadata test.

const invite = (who: TestUser, input: Record<string, unknown>) =>
  gql(
    { cookie: who.cookie },
    `mutation ($input: OrganizationInviteCreateInput!) { organizationInviteCreate(input: $input) { success } }`,
    { input },
  );
const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const ops = (await createTeam(owner, { key: 'OPS', name: 'Operations' })).team.id;
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  return { owner, ops };
}

describe('workspace invites', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('an invite applies its role and teams at sign-up and is used up', async () => {
    const { owner, ops } = await setup();
    const admin = await signUpAs('admin');
    const created = await invite(admin, {
      email: 'guest@example.com',
      role: 'guest',
      teamIds: [ops],
    });
    expect(created.body.errors).toBeUndefined();
    const guest = await signUpTestUser({ email: 'guest@example.com' });
    expect(await workspaceRole(guest.userId)).toBe('guest');
    const teams = await gqlData(guest, '{ teams { nodes { key } } }');
    expect(teams.teams.nodes.map((t: { key: string }) => t.key)).toEqual(['OPS']);
    const pending = await gqlData(owner, '{ organizationInvites { nodes { email } } }');
    expect(pending.organizationInvites.nodes.map((i: { email: string }) => i.email)).not.toContain(
      'guest@example.com',
    );
  });

  it("invites cannot exceed the inviter's role", async () => {
    await setup();
    const member = await signUpAs('member');
    const admin = await signUpAs('admin');
    expect(code(await invite(member, { email: 'a@example.com', role: 'admin' }))).toBe('FORBIDDEN');
    expect(
      (await invite(admin, { email: 'b@example.com', role: 'owner' })).body.errors?.length,
    ).toBe(1);
    expect(
      (await invite(member, { email: 'c@example.com', role: 'guest' })).body.errors,
    ).toBeUndefined();
    const guest = await signUpAs('guest');
    expect(code(await invite(guest, { email: 'd@example.com', role: 'guest' }))).toBe('FORBIDDEN');
  });

  it('inviting an existing account is refused', async () => {
    const { owner } = await setup();
    const existing = await signUpTestUser();
    expect(code(await invite(owner, { email: existing.email, role: 'user' }))).toBe(
      'INVALID_INPUT',
    );
  });

  it('applies an invite to the account its address signs up with', async () => {
    const { owner, ops } = await setup();
    process.env.APPROVED_EMAIL_DOMAINS = '';
    try {
      await invite(owner, { email: 'inv@other.test', role: 'admin', teamIds: [ops] });
      const invited = await signUpTestUser({ email: 'inv@other.test' });
      expect(await workspaceRole(invited.userId)).toBe('admin');
      expect(
        await signUpTestUser({ email: 'stranger@other.test' }).then(
          () => 'joined',
          () => 'refused',
        ),
      ).toBe('refused');
    } finally {
      process.env.APPROVED_EMAIL_DOMAINS = 'example.com';
    }
  });
});

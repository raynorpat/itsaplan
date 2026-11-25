import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, signUpAs } from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Workspace invites (organizationInviteCreate): an invite carries a role and teams,
// applied when the invited address signs up (sign-in.test.ts); nobody invites above
// their own role; an existing account cannot be invited. Token visibility is in the
// invite-metadata test.

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

  it("invites cannot exceed the inviter's role", async () => {
    await setup();
    const member = await signUpAs('member');
    const admin = await signUpAs('admin');
    expect(code(await invite(member, { email: 'a@example.com', role: 'admin' }))).toBe('FORBIDDEN');
    // Nobody invites an owner: the role is not offered.
    const ownerInvite = await invite(admin, { email: 'b@example.com', role: 'owner' });
    expect(code(ownerInvite)).toBe('INVALID_INPUT');
    expect(ownerInvite.body.errors?.[0]?.message).toBe('Role owner is not supported');
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
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  createWebhook,
  gqlData,
  makePrivate,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { createApiKey, gql } from '../../../__tests__/helpers/linear';
import { webhookDeliveries } from '../../../__tests__/helpers/webhooks';
import { workspaceRole } from '../../../shared/access';

// Joining teams, workspace role changes, suspension, and all-teams webhooks that
// skip private teams.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const mkt = (await createTeam(owner, { key: 'MKT', name: 'Marketing' })).team.id;
  const sec = (await createTeam(owner, { key: 'SEC', name: 'Secret' })).team.id;
  await makePrivate(owner, 'SEC');
  return { owner, mkt, sec };
}

const join = (who: TestUser, teamId: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { teamMembershipCreate(input: { teamId: "${teamId}", userId: "${who.userId}" }) { success } }`,
  );
const changeRole = (who: TestUser, id: string, role: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { userChangeRole(id: "${id}", role: ${role}) { success } }`,
  );
const suspend = (who: TestUser, id: string, op: 'userSuspend' | 'userUnsuspend' = 'userSuspend') =>
  gql({ cookie: who.cookie }, `mutation { ${op}(id: "${id}") { success } }`);

describe('roles administration', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('anyone but a guest can join a public team', async () => {
    const { owner, mkt, sec } = await setup();
    const member = await signUpAs('member');
    expect((await join(member, mkt)).body.errors).toBeUndefined();
    const members = await gqlData(
      owner,
      `{ team(id: "${mkt}") { memberships { nodes { user { id } } } } }`,
    );
    expect(
      members.team.memberships.nodes.map((m: { user: { id: string } }) => m.user.id),
    ).toContain(member.userId);
    const guest = await signUpAs('guest');
    expect(code(await join(guest, mkt))).toBe('ENTITY_NOT_FOUND');
    expect(code(await join(member, sec))).toBe('ENTITY_NOT_FOUND');
  });

  it('role changes follow the table and keep an owner', async () => {
    const { owner } = await setup();
    const admin = await signUpAs('admin');
    const other = await signUpAs('admin');
    const member = await signUpAs('member');
    expect((await changeRole(admin, member.userId, 'guest')).body.errors).toBeUndefined();
    expect(await workspaceRole(member.userId)).toBe('guest');
    expect(code(await changeRole(admin, other.userId, 'user'))).toBe('FORBIDDEN');
    expect(code(await changeRole(admin, member.userId, 'owner'))).toBe('FORBIDDEN');
    expect(code(await changeRole(owner, owner.userId, 'admin'))).toBe('INVALID_INPUT');
    expect(code(await suspend(owner, owner.userId))).toBe('INVALID_INPUT');
  });

  it('a suspended user cannot sign in or use an API key', async () => {
    const { owner } = await setup();
    const member = await signUpAs('member', { email: 'sus@example.com' });
    const key = await createApiKey(member.cookie);
    expect((await suspend(owner, member.userId)).body.errors).toBeUndefined();
    // Signing in again (by magic link) is refused while suspended.
    expect(
      await signUpTestUser({ email: 'sus@example.com' }).then(
        () => 'signed in',
        () => 'refused',
      ),
    ).toBe('refused');
    expect((await gql({ authorization: key }, '{ viewer { id } }')).status).toBe(401);
    expect((await gql({ cookie: member.cookie }, '{ viewer { id } }')).status).toBe(401);
    expect((await suspend(owner, member.userId, 'userUnsuspend')).body.errors).toBeUndefined();
    expect((await gql({ authorization: key }, '{ viewer { id } }')).status).toBe(200);
  });

  it('all-teams webhooks skip private teams', async () => {
    const { owner, mkt, sec } = await setup();
    const hook = await createWebhook(owner, {
      url: 'https://example.com/all',
      resourceTypes: ['Issue'],
      allPublicTeams: true,
    });
    await createIssue(owner, { teamId: sec, title: 'SEC' });
    await createIssue(owner, { teamId: mkt, title: 'MKT' });
    const items = (await webhookDeliveries(hook.id)).data.items;
    const titles = items.map((d) => (d.payload as { data: { title: string } }).data.title);
    expect(titles).toEqual(['MKT']);
  });

  it('a suspended user receives no notifications', async () => {
    const { owner, mkt } = await setup();
    const member = await signUpAs('member');
    await addMember(owner, mkt, member.userId);
    await suspend(owner, member.userId);
    await createIssue(owner, { teamId: mkt, title: 'T', assigneeId: member.userId });
    await suspend(owner, member.userId, 'userUnsuspend');
    const again = await signUpTestUser({ email: member.email });
    const inbox = await gqlData(again, '{ notifications { nodes { id } } }');
    expect(inbox.notifications.nodes).toHaveLength(0);
  });

  it('admins and owners can add themselves to a private team; members and guests cannot', async () => {
    const { sec } = await setup();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');
    const guest = await signUpAs('guest');
    expect(code(await join(member, sec))).toBe('ENTITY_NOT_FOUND');
    expect(code(await join(guest, sec))).toBe('ENTITY_NOT_FOUND');
    expect((await join(admin, sec)).body.errors).toBeUndefined();
    expect((await gql({ cookie: admin.cookie }, `{ team(id: "${sec}") { id } }`)).body.errors).toBe(
      undefined,
    );
  });
});

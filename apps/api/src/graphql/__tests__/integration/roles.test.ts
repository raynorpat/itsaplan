import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import {
  addMember,
  createTeam,
  makePrivate,
  signUpAs,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Linear's roles over GraphQL: role fields on users, team visibility, role changes
// and suspension, team memberships, organization invites and private teams.

type Body = {
  data?: Record<string, unknown>;
  errors?: { message?: string; extensions?: { code?: string } }[];
};
const code = (res: { body: Body }) => res.body.errors?.[0]?.extensions?.code;
const data = <T>(res: { body: Body }) => res.body.data as T;

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await createTeam(owner, { key: 'OPS', name: 'Operations' });
  await createTeam(owner, { key: 'SEC', name: 'Security' });
  await makePrivate(owner, 'SEC');
  const ids = Object.fromEntries(
    await Promise.all(
      ['MKT', 'OPS', 'SEC'].map(async (k) => [k, (await teamView(owner, k)).team.id] as const),
    ),
  );
  return { owner, ids };
}

const teamKeys = async (cookie: string) =>
  data<{ teams: { nodes: { key: string }[] } }>(
    await gql({ cookie }, '{ teams { nodes { key } } }'),
  )
    .teams.nodes.map((t) => t.key)
    .sort();

describe('graphql roles', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('exposes roles on users', async () => {
    const { owner } = await setup();
    const admin = await signUpAs('admin');
    const guest = await signUpAs('guest');
    const member = await signUpAs('member');
    const viewer = async (cookie: string) =>
      data<{ viewer: Record<string, boolean> }>(
        await gql({ cookie }, '{ viewer { admin owner guest active } }'),
      ).viewer;
    expect(await viewer(owner.cookie)).toEqual({
      admin: true,
      owner: true,
      guest: false,
      active: true,
    });
    expect(await viewer(admin.cookie)).toEqual({
      admin: true,
      owner: false,
      guest: false,
      active: true,
    });
    expect(await viewer(member.cookie)).toEqual({
      admin: false,
      owner: false,
      guest: false,
      active: true,
    });
    expect(await viewer(guest.cookie)).toEqual({
      admin: false,
      owner: false,
      guest: true,
      active: true,
    });
  });

  it('teams follow visibility', async () => {
    const { owner, ids } = await setup();
    const member = await signUpAs('member');
    const guest = await signUpAs('guest');
    await addMember(owner, 'OPS', guest.userId);
    expect(await teamKeys(member.cookie)).toEqual(['MKT', 'OPS']);
    expect(await teamKeys(guest.cookie)).toEqual(['OPS']);
    const hidden = await gql({ cookie: member.cookie }, `{ team(id: "${ids.SEC}") { id } }`);
    expect(code(hidden)).toBe('ENTITY_NOT_FOUND');
    const guestHidden = await gql({ cookie: guest.cookie }, `{ team(id: "${ids.MKT}") { id } }`);
    expect(code(guestHidden)).toBe('ENTITY_NOT_FOUND');
    const users = data<{ users: { nodes: { id: string }[] } }>(
      await gql({ cookie: guest.cookie }, '{ users { nodes { id } } }'),
    ).users.nodes.map((u) => u.id);
    expect(users).not.toContain(member.userId);
    expect(users).toContain(guest.userId);
  });

  it('userChangeRole, userSuspend, userUnsuspend', async () => {
    const { owner } = await setup();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');
    const change = (cookie: string, id: string, role: string) =>
      gql({ cookie }, `mutation { userChangeRole(id: "${id}", role: ${role}) { success } }`);
    expect(code(await change(admin.cookie, member.userId, 'owner'))).toBe('FORBIDDEN');
    expect((await change(owner.cookie, member.userId, 'admin')).body.errors).toBeUndefined();
    expect(code(await change(owner.cookie, member.userId, 'app'))).toBe('INVALID_INPUT');
    const isAdmin = async () =>
      data<{ user: { admin: boolean; active: boolean } }>(
        await gql({ cookie: owner.cookie }, `{ user(id: "${member.userId}") { admin active } }`),
      ).user;
    expect((await isAdmin()).admin).toBe(true);
    await gql(
      { cookie: owner.cookie },
      `mutation { userSuspend(id: "${member.userId}") { success } }`,
    );
    expect((await isAdmin()).active).toBe(false);
    await gql(
      { cookie: owner.cookie },
      `mutation { userUnsuspend(id: "${member.userId}") { success } }`,
    );
    expect((await isAdmin()).active).toBe(true);
  });

  it('team memberships', async () => {
    const { owner, ids } = await setup();
    const member = await signUpAs('member');
    const other = await signUpAs('member');
    await addMember(owner, 'MKT', member.userId);
    const created = await gql(
      { cookie: member.cookie },
      `mutation { teamMembershipCreate(input: { teamId: "${ids.MKT}", userId: "${other.userId}" }) { success teamMembership { id owner user { id } team { key } } } }`,
    );
    const membership = data<{
      teamMembershipCreate: {
        teamMembership: { id: string; owner: boolean; user: { id: string }; team: { key: string } };
      };
    }>(created).teamMembershipCreate.teamMembership;
    expect(membership).toMatchObject({
      owner: false,
      user: { id: other.userId },
      team: { key: 'MKT' },
    });
    const viaTeam = data<{
      team: { memberships: { nodes: { id: string; owner: boolean; user: { id: string } }[] } };
    }>(
      await gql(
        { cookie: owner.cookie },
        `{ team(id: "${ids.MKT}") { memberships { nodes { id owner user { id } } } } }`,
      ),
    ).team.memberships.nodes;
    expect(viaTeam.find((m) => m.user.id === owner.userId)?.owner).toBe(true);
    expect(viaTeam.map((m) => m.id)).toContain(membership.id);
    const viaUser = data<{ user: { teamMemberships: { nodes: { id: string }[] } } }>(
      await gql(
        { cookie: owner.cookie },
        `{ user(id: "${other.userId}") { teamMemberships { nodes { id } } } }`,
      ),
    ).user.teamMemberships.nodes.map((m) => m.id);
    expect(viaUser).toEqual([membership.id]);
    const denied = await gql(
      { cookie: member.cookie },
      `mutation { teamMembershipDelete(id: "${membership.id}") { success } }`,
    );
    expect(code(denied)).toBe('FORBIDDEN');
    const removed = await gql(
      { cookie: owner.cookie },
      `mutation { teamMembershipDelete(id: "${membership.id}") { success } }`,
    );
    expect(removed.body.errors).toBeUndefined();
    const after = data<{ team: { members: { nodes: { id: string }[] } } }>(
      await gql(
        { cookie: owner.cookie },
        `{ team(id: "${ids.MKT}") { members { nodes { id } } } }`,
      ),
    ).team.members.nodes.map((u) => u.id);
    expect(after).not.toContain(other.userId);
  });

  it('organization invites', async () => {
    const { owner, ids } = await setup();
    const member = await signUpAs('member');
    const created = await gql(
      { cookie: owner.cookie },
      `mutation { organizationInviteCreate(input: { email: "g@example.com", role: guest, teamIds: ["${ids.OPS}"] }) { success organizationInvite { id email role inviter { id } } } }`,
    );
    expect(created.body.errors).toBeUndefined();
    const invite = data<{
      organizationInviteCreate: {
        organizationInvite: { id: string; email: string; role: string; inviter: { id: string } };
      };
    }>(created).organizationInviteCreate.organizationInvite;
    expect(invite).toMatchObject({
      email: 'g@example.com',
      role: 'guest',
      inviter: { id: owner.userId },
    });
    const listed = data<{ organizationInvites: { nodes: { id: string }[] } }>(
      await gql({ cookie: owner.cookie }, '{ organizationInvites { nodes { id } } }'),
    ).organizationInvites.nodes.map((i) => i.id);
    expect(listed).toEqual([invite.id]);
    const above = await gql(
      { cookie: member.cookie },
      'mutation { organizationInviteCreate(input: { email: "a@example.com", role: admin }) { success } }',
    );
    expect(code(above)).toBe('FORBIDDEN');
    const deleted = await gql(
      { cookie: owner.cookie },
      `mutation { organizationInviteDelete(id: "${invite.id}") { success } }`,
    );
    expect(deleted.body.errors).toBeUndefined();
    const empty = data<{ organizationInvites: { nodes: unknown[] } }>(
      await gql({ cookie: owner.cookie }, '{ organizationInvites { nodes { id } } }'),
    ).organizationInvites.nodes;
    expect(empty).toEqual([]);
  });

  it('teamCreate makes the creator a team owner; teamUpdate makes it private', async () => {
    const member = await signUpAs('member');
    const client = linearClient(await createApiKey(member.cookie));
    const team = (await (await client.createTeam({ name: 'Design', key: 'DSN' })).team)!;
    expect(team).toMatchObject({ key: 'DSN', private: false });
    const updated = await gql(
      { cookie: member.cookie },
      `mutation { teamUpdate(id: "${team.id}", input: { private: true }) { success } }`,
    );
    expect(updated.body.errors).toBeUndefined();
    const res = data<{
      team: {
        visibility: string;
        private: boolean;
        memberships: { nodes: { owner: boolean; user: { id: string } }[] };
      };
    }>(
      await gql(
        { cookie: member.cookie },
        `{ team(id: "${team.id}") { visibility private memberships { nodes { owner user { id } } } } }`,
      ),
    ).team;
    expect(res).toMatchObject({ visibility: 'private', private: true });
    expect(res.memberships.nodes).toEqual([{ owner: true, user: { id: member.userId } }]);
    const guest = await signUpAs('guest');
    const guestCreate = await gql(
      { cookie: guest.cookie },
      'mutation { teamCreate(input: { name: "G", key: "GST" }) { success } }',
    );
    expect(code(guestCreate)).toBe('FORBIDDEN');
  });

  it('lets a member join a public team they are not in', async () => {
    const { ids } = await setup();
    const member = await signUpAs('member');
    const joined = await gql(
      { cookie: member.cookie },
      `mutation { teamMembershipCreate(input: { teamId: "${ids.OPS}", userId: "${member.userId}" }) { success teamMembership { owner user { id } } } }`,
    );
    expect(joined.body.errors).toBeUndefined();
    expect(
      data<{ teamMembershipCreate: { teamMembership: { owner: boolean; user: { id: string } } } }>(
        joined,
      ).teamMembershipCreate.teamMembership,
    ).toMatchObject({ owner: false, user: { id: member.userId } });
  });

  it('lets an admin add themselves to a private team', async () => {
    const { ids } = await setup();
    const admin = await signUpAs('admin');
    const member = await signUpAs('member');
    const create = (cookie: string, userId: string) =>
      gql(
        { cookie },
        `mutation { teamMembershipCreate(input: { teamId: "${ids.SEC}", userId: "${userId}" }) { success } }`,
      );
    const refused = await create(member.cookie, member.userId);
    expect(refused.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
    const joined = await create(admin.cookie, admin.userId);
    expect(joined.body.errors).toBeUndefined();
    expect(await teamKeys(admin.cookie)).toContain('SEC');
  });

  it('keeps project labels from guests', async () => {
    await setup();
    const guest = await signUpAs('guest');
    const res = await gql({ cookie: guest.cookie }, '{ projectLabels { nodes { id } } }');
    expect(res.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
  });
});

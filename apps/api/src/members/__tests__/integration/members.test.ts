import { beforeEach, describe, expect, it } from 'bun:test';
import { db, teamMember, user } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createTeam,
  gqlData,
  makePrivate,
  teamView,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';
import { createClient, install } from '../../../__tests__/helpers/oauth';

// Team members over GraphQL: listing a team's memberships, removing a member or
// leaving the team (teamMembershipDelete), and app users, whose memberships only
// their install manages. Making a member a team owner is the instance plugin's
// (instance-plugin.test.ts).

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

async function setupOwner() {
  const owner = await signUpTestUser();
  const teamId = (await createTeam(owner, { key: 'MKT', name: 'Marketing' })).team.id;
  return { owner, teamId };
}

// Adds a fresh workspace member to MKT and returns them with their membership id.
async function joinMkt(owner: TestUser) {
  const member = await signUpTestUser();
  const membershipId = await addMember(owner, 'MKT', member.userId);
  return { member, membershipId };
}

const remove = (who: TestUser, membershipId: string) =>
  gql(
    { cookie: who.cookie },
    `mutation { teamMembershipDelete(id: "${membershipId}") { success } }`,
  );
const memberIds = async (who: TestUser) =>
  (await teamView(who, 'MKT')).members.map((m) => m.userId);
const seesTeam = async (who: TestUser) =>
  !(await gql({ cookie: who.cookie }, '{ team(id: "MKT") { id } }')).body.errors;

describe('team members', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists the owner alone on a fresh team, as a team owner', async () => {
    const { owner } = await setupOwner();
    expect((await teamView(owner, 'MKT')).members).toEqual([
      { id: expect.any(String), owner: true, userId: owner.userId },
    ]);
  });

  it('lists an added member to any member', async () => {
    const { owner } = await setupOwner();
    const { member } = await joinMkt(owner);
    const members = (await teamView(member, 'MKT')).members;
    expect(members.map((m) => m.userId).sort()).toEqual([owner.userId, member.userId].sort());
    expect(members.find((m) => m.userId === member.userId)?.owner).toBe(false);
  });

  it('hides a private team from a non-member', async () => {
    const { owner } = await setupOwner();
    await makePrivate(owner, 'MKT');
    const outsider = await signUpTestUser();
    const res = await gql(
      { cookie: outsider.cookie },
      '{ team(id: "MKT") { memberships { nodes { id } } } }',
    );
    expect(code(res)).toBe('ENTITY_NOT_FOUND');
  });

  it('lets an owner remove a member, revoking their access to a private team', async () => {
    const { owner } = await setupOwner();
    await makePrivate(owner, 'MKT');
    const { member, membershipId } = await joinMkt(owner);
    expect((await remove(owner, membershipId)).body.errors).toBeUndefined();
    expect(await memberIds(owner)).toEqual([owner.userId]);
    expect(await seesTeam(member)).toBe(false);
  });

  it('lets a member leave the team', async () => {
    const { owner } = await setupOwner();
    await makePrivate(owner, 'MKT');
    const { member, membershipId } = await joinMkt(owner);
    expect((await remove(member, membershipId)).body.errors).toBeUndefined();
    expect(await seesTeam(member)).toBe(false);
  });

  it('refuses a member or an outsider removing another member', async () => {
    const { owner } = await setupOwner();
    const { member: a } = await joinMkt(owner);
    const { member: b, membershipId } = await joinMkt(owner);
    expect(code(await remove(a, membershipId))).toBe('FORBIDDEN');
    const outsider = await signUpTestUser();
    expect(code(await remove(outsider, membershipId))).toBe('FORBIDDEN');
    expect(await memberIds(owner)).toContain(b.userId);
  });

  it('answers an unknown membership with ENTITY_NOT_FOUND', async () => {
    const { owner } = await setupOwner();
    expect(code(await remove(owner, crypto.randomUUID()))).toBe('ENTITY_NOT_FOUND');
  });

  it('lets the last team owner leave; the members then manage the team', async () => {
    const { owner, teamId } = await setupOwner();
    const { member } = await joinMkt(owner);
    const own = (await teamView(owner, 'MKT')).members.find((m) => m.userId === owner.userId)!;
    expect((await remove(owner, own.id)).body.errors).toBeUndefined();
    const created = await gql(
      { cookie: member.cookie },
      `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "Review", type: "started", color: "#000000" }) { success } }`,
    );
    expect(created.body.errors).toBeUndefined();
  });

  it("refuses removing an app user's membership; only its install manages it", async () => {
    const { owner, teamId } = await setupOwner();
    const client = await createClient(owner.cookie, { clientCredentials: true });
    await install(owner.cookie, client, { teamIds: [teamId], publicTeams: false });
    const [row] = await db
      .select({ id: teamMember.id, userId: teamMember.userId })
      .from(teamMember)
      .innerJoin(user, eq(user.id, teamMember.userId))
      .where(and(eq(teamMember.teamId, teamId), eq(user.workspaceRole, 'app')));
    expect(row).toBeTruthy();
    const admin = await signUpTestUser();
    await gqlData(
      owner,
      `mutation { userChangeRole(id: "${admin.userId}", role: admin) { success } }`,
    );
    for (const who of [owner, admin]) {
      const res = await remove(who, row!.id);
      expect(code(res)).toBe('INVALID_INPUT');
      expect(res.body.errors?.[0]?.message).toBe(
        "An application's teams are set when it is installed",
      );
    }
  });

  it('refuses a sortOrder on teamMembershipUpdate, which this instance does not keep', async () => {
    const { owner } = await setupOwner();
    const [own] = (await teamView(owner, 'MKT')).members;
    const res = await gql(
      { cookie: owner.cookie },
      `mutation { teamMembershipUpdate(id: "${own!.id}", input: { sortOrder: 1 }) { success } }`,
    );
    expect(code(res)).toBe('INVALID_INPUT');
    expect(res.body.errors?.[0]?.message).toBe('input.sortOrder is not supported');
  });
});

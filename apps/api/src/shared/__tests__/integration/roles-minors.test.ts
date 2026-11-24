import { beforeEach, describe, expect, it } from 'bun:test';
import { db, user } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { app } from '../../../app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createTeam, gqlData, signUpAs } from '../../../__tests__/helpers/graphql';
import { createApiKey, gql } from '../../../__tests__/helpers/linear';

// Access details from the review of Linear's roles: the first owner under concurrent
// sign-ups, stray role values, suspended API keys on the auth endpoints and the
// initiative lead team.

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const teamId = (await createTeam(o, { key: 'MKT', name: 'Marketing' })).team.id;
  return { o, teamId };
}

describe('roles review details', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('makes only one owner when the first two sign-ups race', async () => {
    await Promise.all([signUpTestUser(), signUpTestUser(), signUpTestUser()]);
    const owners = await db.$count(user, eq(user.workspaceRole, 'owner'));
    expect(owners).toBe(1);
  });

  it('gives a stray workspace role no access to public teams', async () => {
    await setup();
    const stray = await signUpAs('member');
    await db
      .update(user)
      .set({ workspaceRole: sql`'god'` as unknown as string })
      .where(eq(user.id, stray.userId));
    const team = await gql({ cookie: stray.cookie }, '{ team(id: "MKT") { id } }');
    expect(team.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
    const res = await gql({ cookie: stray.cookie }, '{ teams { nodes { key } } }');
    expect(res.body.data).toEqual({ teams: { nodes: [] } });
  });

  it("refuses a suspended user's API key on the auth endpoints", async () => {
    const { o } = await setup();
    const member = await signUpAs('member');
    const key = await createApiKey(member.cookie);
    await gqlData(o, `mutation { userSuspend(id: "${member.userId}") { success } }`);
    const res = await app.handle(
      new Request('http://localhost/api/auth/api-key/list', { headers: { 'x-api-key': key } }),
    );
    expect(res.status).not.toBe(200);
  });

  it('lets a member make a visible public team the lead team of an initiative', async () => {
    const { teamId } = await setup();
    const member = await signUpAs('member');
    const res = await gql(
      { cookie: member.cookie },
      `mutation { initiativeCreate(input: { name: "Grow", leadTeamId: "${teamId}" }) { success } }`,
    );
    expect(res.body.errors).toBeUndefined();
    const guest = await signUpAs('guest');
    const refused = await gql(
      { cookie: guest.cookie },
      `mutation { initiativeCreate(input: { name: "Hide", leadTeamId: "${teamId}" }) { success } }`,
    );
    expect(refused.body.errors?.length).toBeGreaterThan(0);
  });
});

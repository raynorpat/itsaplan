import { beforeEach, describe, expect, it } from 'bun:test';
import { db, user } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { app } from '../../../app';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql } from '../../../__tests__/helpers/linear';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Access details from the review of Linear's roles: delivery history of all-teams
// webhooks, the first owner under concurrent sign-ups, stray role values, suspended
// API keys on the auth endpoints, the project feed and the initiative lead team.

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const owner = authedApi(o.cookie);
  await owner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await owner.teams({ teamKey: 'MKT' }).get()).data!;
  return { o, owner, teamId: view.team.id, stateId: view.states[0]!.id };
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
    const { owner } = await setup();
    const stray = await signUpWithRole('member');
    await db
      .update(user)
      .set({ workspaceRole: sql`'god'` as unknown as string })
      .where(eq(user.id, stray.userId));
    expect((await stray.api.teams({ teamKey: 'MKT' }).get()).status).toBe(404);
    const res = await gql({ cookie: stray.cookie }, '{ teams { nodes { key } } }');
    expect(res.body.data).toEqual({ teams: { nodes: [] } });
    expect(owner).toBeTruthy();
  });

  it("refuses a suspended user's API key on the auth endpoints", async () => {
    const { owner } = await setup();
    const member = await signUpWithRole('member');
    const key = await createApiKey(member.cookie);
    await owner.workspace.users({ userId: member.userId }).suspend.post();
    const res = await app.handle(
      new Request('http://localhost/api/auth/api-key/list', { headers: { 'x-api-key': key } }),
    );
    expect(res.status).not.toBe(200);
  });

  it('shows activity from visible public teams in the project feed', async () => {
    const { owner, teamId, stateId } = await setup();
    const project = (await owner.projects.post({ teamIds: [teamId], name: 'Site' })).data!;
    await owner
      .teams({ teamKey: 'MKT' })
      .issues.post({ stateId, title: 'Feed me', projectId: project.id });
    const member = await signUpWithRole('member');
    const feed = (await member.api.projects({ projectId: project.id }).feed.get({ query: {} }))
      .data!;
    expect(feed.items.map((i) => i.issueIdentifier)).toContain('MKT-1');
  });

  it('lets a member make a visible public team the lead team of an initiative', async () => {
    const { teamId } = await setup();
    const member = await signUpWithRole('member');
    const res = await gql(
      { cookie: member.cookie },
      `mutation { initiativeCreate(input: { name: "Grow", leadTeamId: "${teamId}" }) { success } }`,
    );
    expect(res.body.errors).toBeUndefined();
    const guest = await signUpWithRole('guest');
    const refused = await gql(
      { cookie: guest.cookie },
      `mutation { initiativeCreate(input: { name: "Hide", leadTeamId: "${teamId}" }) { success } }`,
    );
    expect(refused.body.errors?.length).toBeGreaterThan(0);
  });
});

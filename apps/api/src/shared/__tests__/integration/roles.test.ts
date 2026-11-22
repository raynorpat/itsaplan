import { beforeEach, describe, expect, it } from 'bun:test';
import { db, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { gql } from '../../../__tests__/helpers/linear';
import { setWorkspaceRole, type WorkspaceRole } from '../../access';

// Linear's access model: workspace roles (owner, admin, member, guest), public and
// private teams, and team owners. Owners, admins and members see and work in every
// public team and their private teams; guests only their teams. Team management
// needs a team owner or a workspace admin, or any member when the team has no owner.

async function user(role: WorkspaceRole): Promise<TestUser & { api: Api }> {
  const u = await signUpTestUser();
  await setWorkspaceRole(u.userId, role);
  return { ...u, api: authedApi(u.cookie) };
}

async function addToTeam(owner: Api, teamKey: string, who: TestUser) {
  await owner.teams({ teamKey: teamKey }).members.post({ userId: who.userId });
}

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const owner = authedApi(o.cookie);
  await owner.teams.post({ key: 'MKT', name: 'Marketing' });
  const view = (await owner.teams({ teamKey: 'MKT' }).get()).data!;
  const stateId = view.states[0]!.id;
  const issue = (await owner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'Task' }))
    .data!;
  return { o, owner, stateId, issueId: issue.id, teamId: view.team.id };
}

describe('workspace roles and team visibility', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('members work in public teams without joining', async () => {
    const { issueId } = await setup();
    const member = await user('member');
    expect((await member.api.issues({ issueId }).get()).status).toBe(200);
    const comment = await member.api.issues({ issueId }).comments.post({ body: 'Hi' } as never);
    expect(comment.status).toBe(201);
  });

  it('private teams are members only, even for admins', async () => {
    const { owner, issueId } = await setup();
    await owner.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' } as never);
    const admin = await user('admin');
    expect((await admin.api.issues({ issueId }).get()).status).toBe(404);
    expect((await admin.api.issues({ issueId }).feed.get({ query: {} })).status).toBe(404);
    const doc = await gql(
      { cookie: admin.cookie },
      `{ issue(id: "${issueId}") { id } documents { nodes { id } } }`,
    );
    expect(doc.body.errors?.[0]?.extensions?.code).toBe('ENTITY_NOT_FOUND');
    await addToTeam(owner, 'MKT', admin);
    expect((await admin.api.issues({ issueId }).get()).status).toBe(200);
  });

  it('guests see only their teams', async () => {
    const { owner, issueId } = await setup();
    await owner.teams.post({ key: 'OPS', name: 'Operations' });
    const guest = await user('guest');
    await addToTeam(owner, 'OPS', guest);
    expect((await guest.api.issues({ issueId }).get()).status).toBe(404);
    expect((await guest.api.teams({ teamKey: 'MKT' }).get()).status).toBe(404);
    expect((await guest.api.teams({ teamKey: 'OPS' }).get()).status).toBe(200);
    const teams = (await guest.api.teams.get({ query: {} })).data!.map((t) => t.key);
    expect(teams).toEqual(['OPS']);
  });

  it('team management needs a team owner or an admin', async () => {
    const { o, owner, teamId } = await setup();
    const member = await user('member');
    await addToTeam(owner, 'MKT', member);
    const create = (api: Api, name: string) =>
      api.teams({ teamKey: 'MKT' }).states.post({ name, stateType: 'started' } as never);
    expect((await create(member.api, 'Review')).status).toBe(403);
    const admin = await user('admin');
    expect((await create(admin.api, 'QA')).status).toBe(201);
    await db
      .update(teamMember)
      .set({ owner: false })
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, o.userId)));
    expect((await create(member.api, 'Review')).status).toBe(201);
  });

  it('workspace actions follow the role table', async () => {
    await setup();
    const guest = await user('guest');
    expect((await guest.api.teams.post({ key: 'GST', name: 'Guests' })).status).toBe(403);
    const member = await user('member');
    const hook = (api: Api) =>
      api
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] });
    expect((await hook(member.api)).status).toBe(403);
    const admin = await user('admin');
    expect((await hook(admin.api)).status).toBe(201);
  });
});

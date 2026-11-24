import { beforeEach, describe, expect, it } from 'bun:test';
import { db, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import {
  addMember,
  createIssue,
  createTeam,
  makePrivate,
  signUpAs,
} from '../../../__tests__/helpers/graphql';
import { gql } from '../../../__tests__/helpers/linear';

// Linear's access model: workspace roles (owner, admin, member, guest), public and
// private teams, and team owners. Owners, admins and members see and work in every
// public team and their private teams; guests only their teams. Team management
// needs a team owner or a workspace admin, or any member when the team has no owner.

const code = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;
const readIssue = (who: TestUser, id: string) =>
  gql({ cookie: who.cookie }, `{ issue(id: "${id}") { id } }`);

async function setup() {
  const o = await signUpTestUser({ name: 'Owner' });
  const teamId = (await createTeam(o, { key: 'MKT', name: 'Marketing' })).team.id;
  const issue = await createIssue(o, { teamId, title: 'Task' });
  return { o, teamId, issueId: issue.id };
}

describe('workspace roles and team visibility', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('members work in public teams without joining', async () => {
    const { issueId } = await setup();
    const member = await signUpAs('member');
    expect((await readIssue(member, issueId)).body.errors).toBeUndefined();
    const comment = await gql(
      { cookie: member.cookie },
      `mutation { commentCreate(input: { issueId: "${issueId}", body: "Hi" }) { success } }`,
    );
    expect(comment.body.errors).toBeUndefined();
  });

  it('private teams are members only, even for admins', async () => {
    const { o, issueId } = await setup();
    await makePrivate(o, 'MKT');
    const admin = await signUpAs('admin');
    expect(code(await readIssue(admin, issueId))).toBe('ENTITY_NOT_FOUND');
    const doc = await gql(
      { cookie: admin.cookie },
      `{ issue(id: "${issueId}") { id } documents { nodes { id } } }`,
    );
    expect(code(doc)).toBe('ENTITY_NOT_FOUND');
    await addMember(o, 'MKT', admin.userId);
    expect((await readIssue(admin, issueId)).body.errors).toBeUndefined();
  });

  it('guests see only their teams', async () => {
    const { o, issueId } = await setup();
    await createTeam(o, { key: 'OPS', name: 'Operations' });
    const guest = await signUpAs('guest');
    await addMember(o, 'OPS', guest.userId);
    expect(code(await readIssue(guest, issueId))).toBe('ENTITY_NOT_FOUND');
    expect(code(await gql({ cookie: guest.cookie }, '{ team(id: "MKT") { id } }'))).toBe(
      'ENTITY_NOT_FOUND',
    );
    expect((await gql({ cookie: guest.cookie }, '{ team(id: "OPS") { id } }')).body.errors).toBe(
      undefined,
    );
    const teams = await gql({ cookie: guest.cookie }, '{ teams { nodes { key } } }');
    expect(teams.body.data).toEqual({ teams: { nodes: [{ key: 'OPS' }] } });
  });

  it('team management needs a team owner or an admin', async () => {
    const { o, teamId } = await setup();
    const member = await signUpAs('member');
    await addMember(o, 'MKT', member.userId);
    const create = (who: TestUser, name: string) =>
      gql(
        { cookie: who.cookie },
        `mutation { workflowStateCreate(input: { teamId: "${teamId}", name: "${name}", type: "started", color: "#000000" }) { success } }`,
      );
    expect(code(await create(member, 'Review'))).toBe('FORBIDDEN');
    const admin = await signUpAs('admin');
    expect((await create(admin, 'QA')).body.errors).toBeUndefined();
    await db
      .update(teamMember)
      .set({ owner: false })
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, o.userId)));
    expect((await create(member, 'Review')).body.errors).toBeUndefined();
  });

  it('workspace actions follow the role table', async () => {
    const { teamId } = await setup();
    const guest = await signUpAs('guest');
    const team = await gql(
      { cookie: guest.cookie },
      'mutation { teamCreate(input: { key: "GST", name: "Guests" }) { success } }',
    );
    expect(code(team)).toBe('FORBIDDEN');
    const hook = (who: TestUser) =>
      gql(
        { cookie: who.cookie },
        `mutation { webhookCreate(input: { url: "https://example.com/h", resourceTypes: ["Issue"], teamId: "${teamId}" }) { success } }`,
      );
    expect(code(await hook(await signUpAs('member')))).toBe('FORBIDDEN');
    expect((await hook(await signUpAs('admin'))).body.errors).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Teams (projects), users, and workflow states (columns) over the Linear API, and
// the Relay pagination they share.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  // A second project the owner is not a member of.
  const other = await signUpTestUser({ name: 'Other' });
  await authedApi(other.cookie).projects.post({ key: 'OPS', name: 'Operations' });
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, asOwner, other, client };
}

const errorCode = (res: { body: { errors?: { extensions?: { code?: string } }[] } }) =>
  res.body.errors?.[0]?.extensions?.code;

describe('graphql teams, users and workflow states', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('teams', () => {
    it("lists only the viewer's teams", async () => {
      const { client } = await setup();
      const teams = await client.teams();
      expect(teams.nodes.map((t) => t.key)).toEqual(['MKT']);
      expect(teams.nodes[0].name).toBe('Marketing');
    });

    it('reads a team by key or id', async () => {
      const { client } = await setup();
      const byKey = await client.team('MKT');
      const byId = await client.team(byKey.id);
      expect(byId.key).toBe('MKT');
    });

    it('hides a team the viewer is not a member of', async () => {
      const { owner } = await setup();
      const res = await gql({ cookie: owner.cookie }, '{ team(id: "OPS") { id } }');
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });

    it("resolves the team's organization", async () => {
      const { client } = await setup();
      const team = await client.team('MKT');
      const org = await client.organization;
      expect((await team.organization).id).toBe(org.id);
    });
  });

  describe('workflow states', () => {
    it("lists a team's states with their types", async () => {
      const { client } = await setup();
      const team = await client.team('MKT');
      const states = await team.states();
      expect(states.nodes.map((s) => s.type).sort()).toEqual(
        ['backlog', 'canceled', 'completed', 'started', 'unstarted'].sort(),
      );
      expect((await states.nodes[0].team)?.id).toBe(team.id);
    });

    it('reads one state and filters states by type', async () => {
      const { client } = await setup();
      const started = await client.workflowStates({ filter: { type: { eq: 'started' } } });
      expect(started.nodes).toHaveLength(1);
      const one = await client.workflowState(started.nodes[0].id);
      expect(one.type).toBe('started');
    });

    it("does not list another team's states", async () => {
      const { client } = await setup();
      const all = await client.workflowStates();
      expect(all.nodes).toHaveLength(5);
    });

    it('lists an archived state only with includeArchived', async () => {
      const { asOwner, client } = await setup();
      const review = await asOwner
        .projects({ projectKey: 'MKT' })
        .columns.post({ name: 'Review', stateType: 'started' });
      await asOwner
        .projects({ projectKey: 'MKT' })
        .columns({ columnId: review.data!.id })
        .archive.post();
      const active = await client.workflowStates();
      expect(active.nodes.map((s) => s.id)).not.toContain(review.data!.id);
      const all = await client.workflowStates({ includeArchived: true });
      expect(all.nodes.map((s) => s.id)).toContain(review.data!.id);
    });

    it('rejects a filter key that is not supported', async () => {
      const { owner } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        '{ workflowStates(filter: { issues: { every: { id: { eq: "x" } } } }) { nodes { id } } }',
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
      expect(res.body.errors?.[0].message).toContain('issues');
    });
  });

  describe('pagination', () => {
    it('pages forward with first and after, without repeats', async () => {
      const { client } = await setup();
      const seen: string[] = [];
      let page = await client.workflowStates({ first: 2 });
      seen.push(...page.nodes.map((s) => s.id));
      expect(page.pageInfo.hasNextPage).toBe(true);
      while (page.pageInfo.hasNextPage) {
        page = await client.workflowStates({ first: 2, after: page.pageInfo.endCursor });
        seen.push(...page.nodes.map((s) => s.id));
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('pages backward with last and before', async () => {
      const { client } = await setup();
      const all = await client.workflowStates();
      const last = await client.workflowStates({ last: 2 });
      expect(last.nodes.map((s) => s.id)).toEqual(all.nodes.slice(-2).map((s) => s.id));
      expect(last.pageInfo.hasPreviousPage).toBe(true);
    });

    it('accepts first: 250 and rejects first: 251', async () => {
      const { owner } = await setup();
      const ok = await gql(
        { cookie: owner.cookie },
        '{ workflowStates(first: 250) { nodes { id } } }',
      );
      expect(ok.body.errors).toBeUndefined();
      const bad = await gql(
        { cookie: owner.cookie },
        '{ workflowStates(first: 251) { nodes { id } } }',
      );
      expect(errorCode(bad)).toBe('INVALID_INPUT');
    });

    it('rejects a malformed cursor', async () => {
      const { owner } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        '{ workflowStates(after: "garbage") { nodes { id } } }',
      );
      expect(errorCode(res)).toBe('INVALID_INPUT');
    });
  });

  describe('users', () => {
    it('lists the viewer and users who share a project, not others', async () => {
      const { owner, asOwner, other, client } = await setup();
      const member: TestUser = await signUpTestUser({ name: 'Member' });
      const invite = await asOwner
        .projects({ projectKey: 'MKT' })
        .invites.post({ email: member.email, role: 'member' });
      await authedApi(member.cookie).invites({ token: invite.data!.token }).accept.post();

      const users = await client.users();
      const ids = users.nodes.map((u) => u.id);
      expect(ids).toContain(owner.userId);
      expect(ids).toContain(member.userId);
      expect(ids).not.toContain(other.userId);
    });

    it('hides a user who shares no project', async () => {
      const { owner, other } = await setup();
      const res = await gql({ cookie: owner.cookie }, `{ user(id: "${other.userId}") { id } }`);
      expect(errorCode(res)).toBe('ENTITY_NOT_FOUND');
    });

    it('marks the viewer with isMe', async () => {
      const { owner, client } = await setup();
      const me = await client.user(owner.userId);
      expect(me.isMe).toBe(true);
    });

    it("lists a team's members", async () => {
      const { owner, client } = await setup();
      const team = await client.team('MKT');
      const members = await team.members();
      expect(members.nodes.map((u) => u.id)).toEqual([owner.userId]);
    });
  });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { setWorkspaceRole } from '../../../shared/access';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';

// Teams (teams), users, and workflow states (columns) over the Linear API, and
// the Relay pagination they share.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.teams.post({ key: 'MKT', name: 'Marketing' });
  // A second team the owner is not a member of.
  const other = await signUpTestUser({ name: 'Other' });
  await authedApi(other.cookie).teams.post({
    key: 'OPS',
    name: 'Operations',
    visibility: 'private',
  });
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

    it("counts the team's issues", async () => {
      const { asOwner, client } = await setup();
      const view = await asOwner.teams({ teamKey: 'MKT' }).get();
      const stateId = view.data!.states[0].id;
      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'a' });
      await asOwner.teams({ teamKey: 'MKT' }).issues.post({ stateId, title: 'b' });
      expect((await client.team('MKT')).issueCount).toBe(2);
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
        .teams({ teamKey: 'MKT' })
        .states.post({ name: 'Review', stateType: 'started' });
      await asOwner.teams({ teamKey: 'MKT' }).states({ stateId: review.data!.id }).archive.post();
      const active = await client.workflowStates();
      expect(active.nodes.map((s) => s.id)).not.toContain(review.data!.id);
      const all = await client.workflowStates({ includeArchived: true });
      expect(all.nodes.map((s) => s.id)).toContain(review.data!.id);
    });

    it('ignores a null in/nin comparator', async () => {
      const { owner } = await setup();
      const res = await gql(
        { cookie: owner.cookie },
        '{ workflowStates(filter: { type: { in: null } }) { nodes { id } } }',
      );
      expect(res.body.errors).toBeUndefined();
      expect((res.body.data!.workflowStates as { nodes: unknown[] }).nodes).toHaveLength(5);
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
    it('lists every workspace user to a member, and only team mates to a guest', async () => {
      const { owner, asOwner, other, client } = await setup();
      const guest = await signUpTestUser({ name: 'Guest' });
      await setWorkspaceRole(guest.userId, 'guest');
      await asOwner.teams({ teamKey: 'MKT' }).members.post({ userId: guest.userId });

      const ids = (await client.users()).nodes.map((u) => u.id);
      expect(ids).toEqual(expect.arrayContaining([owner.userId, guest.userId, other.userId]));
      const guestClient = linearClient(await createApiKey(guest.cookie));
      const seen = (await guestClient.users()).nodes.map((u) => u.id);
      expect(seen).toContain(owner.userId);
      expect(seen).not.toContain(other.userId);
    });

    it('hides a user who shares no team from a guest', async () => {
      const { other } = await setup();
      const guest = await signUpTestUser();
      await setWorkspaceRole(guest.userId, 'guest');
      const res = await gql({ cookie: guest.cookie }, `{ user(id: "${other.userId}") { id } }`);
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

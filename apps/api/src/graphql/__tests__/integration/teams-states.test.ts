import { beforeEach, describe, expect, it } from 'bun:test';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { setWorkspaceRole } from '../../../shared/access';
import { createApiKey, gql, linearClient } from '../../../__tests__/helpers/linear';
import {
  addMember,
  createIssue,
  createState,
  createTeam,
  teamView,
} from '../../../__tests__/helpers/graphql';

// Teams (teams), users, and workflow states (columns) over the Linear API, and
// the Relay pagination they share.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  // A second team the owner is not a member of.
  const other = await signUpTestUser({ name: 'Other' });
  await createTeam(other, {
    key: 'OPS',
    name: 'Operations',
    visibility: 'private',
  });
  const client = linearClient(await createApiKey(owner.cookie));
  return { owner, other, client };
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
      const { owner, client } = await setup();
      const stateId = (await teamView(owner, 'MKT')).states[0]!.id;
      await createIssue(owner, { teamId: 'MKT', stateId, title: 'a' });
      await createIssue(owner, { teamId: 'MKT', stateId, title: 'b' });
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
    it('keeps a reorder inside its type group when later states were added to earlier groups', async () => {
      const { owner, client } = await setup();
      const team = await client.team('MKT');
      type StateNode = { id: string; name: string; type: string; position: number };
      const create = async (name: string, type: string) => {
        const res = await gql(
          { cookie: owner.cookie },
          `mutation($input: WorkflowStateCreateInput!) { workflowStateCreate(input: $input) { workflowState { id } } }`,
          { input: { teamId: team.id, name, type, color: '#123456' } },
        );
        const data = res.body.data as { workflowStateCreate: { workflowState: { id: string } } };
        return data.workflowStateCreate.workflowState;
      };
      // The started group, in position order.
      const started = async () => {
        const res = await gql(
          { cookie: owner.cookie },
          `{ team(id: "MKT") { states { nodes { id name type position } } } }`,
        );
        const data = res.body.data as { team: { states: { nodes: StateNode[] } } };
        return data.team.states.nodes
          .filter((n) => n.type === 'started')
          .sort((a, b) => a.position - b.position);
      };
      const names = async () => (await started()).map((n) => n.name);
      const move = (id: string, position: number) =>
        gql(
          { cookie: owner.cookie },
          `mutation($id: String!, $input: WorkflowStateUpdateInput!) { workflowStateUpdate(id: $id, input: $input) { success } }`,
          { id, input: { position } },
        );
      await create('Icebox', 'backlog');
      await create('Review', 'started');
      const qa = await create('QA', 'started');
      expect(await names()).toEqual(['In Progress', 'Review', 'QA']);
      // Between In Progress and Review, as the web computes it.
      const [inProgress, review] = await started();
      await move(qa.id, (inProgress.position + review.position) / 2);
      expect(await names()).toEqual(['In Progress', 'QA', 'Review']);
      // To last in the group, after a new backlog state took the highest position.
      await create('Later', 'backlog');
      const group = await started();
      await move(qa.id, group[group.length - 1].position + 1);
      expect(await names()).toEqual(['In Progress', 'Review', 'QA']);
    });

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
      const { owner, client } = await setup();
      const review = await createState(owner, { teamId: 'MKT', name: 'Review', type: 'started' });
      await client.archiveWorkflowState(review.id);
      const active = await client.workflowStates();
      expect(active.nodes.map((s) => s.id)).not.toContain(review.id);
      const all = await client.workflowStates({ includeArchived: true });
      expect(all.nodes.map((s) => s.id)).toContain(review.id);
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
      const before = await client.workflowStates({ last: 2, before: last.pageInfo.startCursor });
      expect(before.nodes.map((s) => s.id)).toEqual(all.nodes.slice(-4, -2).map((s) => s.id));
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
      const { owner, other, client } = await setup();
      const guest = await signUpTestUser({ name: 'Guest' });
      await setWorkspaceRole(guest.userId, 'guest');
      await addMember(owner, 'MKT', guest.userId);

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

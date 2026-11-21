import { describe, it, expect, beforeEach } from 'bun:test';
import { resetDb } from '../../../__tests__/helpers/db';
import { addUser, createAgentUser, joinTeam, setup } from '../helpers';

// The instance team directory under god mode: listing every team on the
// instance with what it holds, and reading one with its members. These routes read
// teams the caller is not a member of, which no team-scoped route may do, so
// they sit behind the god guard like the rest of the plugin.

const PAGE = { limit: 50, offset: 0 };

describe('god teams', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('access', () => {
    it('refuses both routes for a user who is not the instance owner', async () => {
      const { god } = await setup();
      const created = await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const outsider = await addUser();

      expect((await outsider.api.god.teams.get({ query: PAGE })).status).toBe(403);
      expect((await outsider.api.god.teams({ teamId: created.data!.id }).get()).status).toBe(403);
    });
  });

  describe('list — GET /god/teams', () => {
    it('lists every team on the instance, including ones the owner is not in', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      await alice.api.teams.post({ key: 'ALC', name: 'Alice Only' });

      const res = await god.api.god.teams.get({ query: PAGE });

      expect(res.status).toBe(200);
      expect(res.data?.total).toBe(1);
      expect(res.data?.items[0]).toMatchObject({
        key: 'ALC',
        name: 'Alice Only',
        mcpEnabled: false,
        memberCount: 1,
        issueCount: 0,
      });
    });

    it('counts what a team holds and when it was last active', async () => {
      const { god } = await setup();
      const created = await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const team = created.data!;
      const alice = await addUser({ email: 'alice@example.com' });
      await joinTeam(god, alice, 'MKT', 'member');

      const view = await god.api.teams({ teamKey: 'MKT' }).get();
      const issue = await god.api.teams({ teamKey: 'MKT' }).issues.post({
        title: 'First',
        stateId: view.data!.states[0]!.id,
      });
      await god.api.projects.post({ name: 'Launch', teamIds: [view.data!.team.id] });
      await createAgentUser(god, 'MKT');

      const res = await god.api.god.teams.get({ query: PAGE });
      const row = res.data!.items.find((p) => p.id === team.id)!;

      expect(row).toMatchObject({
        // Owner, the joined member, and the agent user (agents are team members).
        memberCount: 3,
        issueCount: 1,
        archivedIssueCount: 0,
        projectCount: 1,
        agentCount: 1,
        dashboardCount: 0,
        viewCount: 0,
        skillCount: 0,
        toolCount: 0,
        integrationCount: 0,
      });
      // Creating the issue wrote its first feed entry.
      expect(row.lastActivityAt).not.toBeNull();
      expect(issue.status).toBe(201);
    });

    it('counts an archived issue apart from the active ones', async () => {
      const { god } = await setup();
      await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const view = await god.api.teams({ teamKey: 'MKT' }).get();
      const created = await god.api.teams({ teamKey: 'MKT' }).issues.post({
        title: 'Old',
        stateId: view.data!.states[0]!.id,
      });
      await god.api.issues({ issueId: created.data!.id }).archive.post();

      const res = await god.api.god.teams.get({ query: PAGE });

      expect(res.data?.items[0]).toMatchObject({ issueCount: 0, archivedIssueCount: 1 });
    });

    it('matches the search term against the key or the name', async () => {
      const { god } = await setup();
      await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await god.api.teams.post({ key: 'ENG', name: 'Engineering' });

      const byKey = await god.api.god.teams.get({ query: { ...PAGE, search: 'mkt' } });
      const byName = await god.api.god.teams.get({ query: { ...PAGE, search: 'engineer' } });
      const noMatch = await god.api.god.teams.get({ query: { ...PAGE, search: 'nothing' } });

      expect(byKey.data?.items.map((p) => p.key)).toEqual(['MKT']);
      expect(byName.data?.items.map((p) => p.key)).toEqual(['ENG']);
      expect(noMatch.data?.items).toEqual([]);
      // The total counts the matches, not every team.
      expect(byKey.data?.total).toBe(1);
      expect(noMatch.data?.total).toBe(0);
    });

    it('pages with limit and offset while the total stays the full match count', async () => {
      const { god } = await setup();
      await god.api.teams.post({ key: 'ONE', name: 'One' });
      await god.api.teams.post({ key: 'TWO', name: 'Two' });
      await god.api.teams.post({ key: 'THR', name: 'Three' });

      const first = await god.api.god.teams.get({ query: { limit: 2, offset: 0 } });
      const second = await god.api.god.teams.get({ query: { limit: 2, offset: 2 } });

      expect(first.data?.items).toHaveLength(2);
      expect(second.data?.items).toHaveLength(1);
      expect(first.data?.total).toBe(3);
      expect(second.data?.total).toBe(3);
      // The two windows together cover every team exactly once.
      const paged = [...first.data!.items, ...second.data!.items].map((p) => p.id);
      expect(new Set(paged).size).toBe(3);
    });

    it('rejects a limit outside the allowed range', async () => {
      const { god } = await setup();

      expect((await god.api.god.teams.get({ query: { ...PAGE, limit: 0 } })).status).toBe(400);
      expect((await god.api.god.teams.get({ query: { ...PAGE, limit: 500 } })).status).toBe(400);
    });
  });

  describe('detail — GET /god/teams/:teamId', () => {
    it('resolves an owner membership to full permissions', async () => {
      const { god } = await setup();
      const alice = await addUser({ name: 'Alice', email: 'alice@example.com' });
      const created = await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await god.api.god.teams({ teamId: created.data!.id }).get();

      expect(res.status).toBe(200);
      expect(res.data?.members).toHaveLength(1);
      expect(res.data?.members[0]).toMatchObject({
        userId: alice.id,
        email: 'alice@example.com',
        isAgent: false,
        role: 'owner',
        roleId: null,
        roleName: null,
      });
      // An owner bypasses the matrix, so every resource comes back granted.
      expect(res.data?.members[0].permissions.work_items.create).toBe(true);
      expect(res.data?.members[0].permissions.members_manage.delete).toBe(true);
    });

    it("resolves a member membership to the assigned role's matrix", async () => {
      const { god } = await setup();
      const created = await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const bob = await addUser({ name: 'Bob', email: 'bob@example.com' });
      await joinTeam(god, bob, 'MKT', 'member');

      const res = await god.api.god.teams({ teamId: created.data!.id }).get();
      const member = res.data!.members.find((m) => m.userId === bob.id)!;

      expect(member.role).toBe('member');
      // Joining without a role assigned leaves the default member matrix, which does
      // not reach role management.
      expect(member.permissions.members_manage.edit).toBe(false);
    });

    it("marks an agent's bot user as an agent", async () => {
      const { god } = await setup();
      const created = await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const agentUserId = await createAgentUser(god, 'MKT');

      const res = await god.api.god.teams({ teamId: created.data!.id }).get();
      const bot = res.data!.members.find((m) => m.userId === agentUserId);

      // An agent reaches the team through a membership like anyone else, so it
      // shows up in the list, flagged.
      expect(bot?.isAgent).toBe(true);
    });

    it('returns 404 for an unknown team and 400 for an id that is not a UUID', async () => {
      const { god } = await setup();

      expect(
        (await god.api.god.teams({ teamId: '00000000-0000-4000-8000-000000000000' }).get()).status,
      ).toBe(404);
      expect((await god.api.god.teams({ teamId: 'abc' }).get()).status).toBe(400);
    });
  });
  it('counts a comment as the latest activity', async () => {
    const { god } = await setup();
    await god.api.teams.post({ key: 'MKT', name: 'Marketing' });
    const team = (await god.api.teams({ teamKey: 'MKT' }).get()).data!;
    const issue = (
      await god.api
        .teams({ teamKey: 'MKT' })
        .issues.post({ stateId: team.states[0].id, title: 'x' })
    ).data!;
    await Bun.sleep(20);
    const comment = (await god.api.issues({ issueId: issue.id }).comments.post({ body: 'later' }))
      .data!;
    const res = await god.api.god.teams.get({ query: PAGE });
    const row = res.data!.items.find((r) => r.id === team.team.id)!;
    expect(new Date(row.lastActivityAt as unknown as string).getTime()).toBe(
      new Date(comment.createdAt as unknown as string).getTime(),
    );
  });
});

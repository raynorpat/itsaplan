import { describe, it, expect, beforeEach } from 'bun:test';
import { resetDb } from '../../../__tests__/helpers/db';
import { addUser, joinTeam, setup } from '../helpers';

// The instance user directory under god mode: listing every account on the instance,
// reading one with the teams it can reach, confirming an email address on the
// owner's behalf, and deleting an account. These routes read across the better-auth
// tables and every team's membership, which no team-scoped route may do, so the
// whole plugin sits behind the god guard.

const ALL = { limit: 50, offset: 0 };

describe('god users', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('access', () => {
    it('refuses every route for a user who is not the instance owner', async () => {
      const { god } = await setup();
      const outsider = await addUser();

      expect((await outsider.api.god.users.get({ query: ALL })).status).toBe(403);
      expect((await outsider.api.god.users({ userId: god.id }).get()).status).toBe(403);
      expect((await outsider.api.god.users({ userId: god.id })['verify-email'].post()).status).toBe(
        403,
      );
      expect((await outsider.api.god.users({ userId: god.id }).delete()).status).toBe(403);
    });
  });

  describe('list — GET /god/users', () => {
    it('reports the sign-in state and team count of each account', async () => {
      const { god } = await setup();
      await god.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await god.api.god.users.get({ query: ALL });

      expect(res.status).toBe(200);
      expect(res.data?.total).toBe(1);
      expect(res.data?.items[0]).toMatchObject({
        id: god.id,
        email: 'root@example.com',
        name: 'Root',
        role: 'owner',
        // A magic link proves the address; there is no password provider.
        emailVerified: true,
        providers: [],
        teamCount: 1,
      });
      expect(res.data?.items[0].lastSeenAt).not.toBeNull();
    });

    it('matches the search term against the name or the email', async () => {
      const { god } = await setup();
      await addUser({ name: 'Alice Smith', email: 'alice@example.com' });
      process.env.APPROVED_EMAIL_DOMAINS = 'example.com,corp.test';
      await addUser({ name: 'Bob Jones', email: 'bob@corp.test' });
      process.env.APPROVED_EMAIL_DOMAINS = 'example.com';

      const byName = await god.api.god.users.get({ query: { ...ALL, search: 'alice' } });
      const byEmail = await god.api.god.users.get({ query: { ...ALL, search: 'corp.test' } });
      const noMatch = await god.api.god.users.get({ query: { ...ALL, search: 'nobody' } });

      expect(byName.data?.items.map((u) => u.email)).toEqual(['alice@example.com']);
      expect(byEmail.data?.items.map((u) => u.email)).toEqual(['bob@corp.test']);
      expect(noMatch.data?.items).toEqual([]);
      // The total counts the matches, not every account.
      expect(byName.data?.total).toBe(1);
      expect(noMatch.data?.total).toBe(0);
    });

    it('pages with limit and offset while the total stays the full match count', async () => {
      const { god } = await setup();
      await addUser();
      await addUser();

      const first = await god.api.god.users.get({ query: { ...ALL, limit: 2, offset: 0 } });
      const second = await god.api.god.users.get({ query: { ...ALL, limit: 2, offset: 2 } });

      expect(first.data?.items).toHaveLength(2);
      expect(second.data?.items).toHaveLength(1);
      expect(first.data?.total).toBe(3);
      expect(second.data?.total).toBe(3);
      // The two windows together cover every account exactly once.
      const paged = [...first.data!.items, ...second.data!.items].map((u) => u.id);
      expect(new Set(paged).size).toBe(3);
    });

    it('rejects a limit outside the allowed range', async () => {
      const { god } = await setup();

      expect((await god.api.god.users.get({ query: { ...ALL, limit: 0 } })).status).toBe(400);
      expect((await god.api.god.users.get({ query: { ...ALL, limit: 500 } })).status).toBe(400);
    });
  });

  describe('detail — GET /god/users/:userId', () => {
    it('reports an owner membership', async () => {
      const { god } = await setup();
      const alice = await addUser({ name: 'Alice', email: 'alice@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await god.api.god.users({ userId: alice.id }).get();

      expect(res.status).toBe(200);
      expect(res.data?.teams).toHaveLength(1);
      expect(res.data?.teams[0]).toMatchObject({
        teamKey: 'MKT',
        teamName: 'Marketing',
        role: 'owner',
        // Alice is the only owner, so deleting her would leave MKT unmanaged.
        ownerCount: 1,
      });
    });

    it('reports a plain membership as member', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await joinTeam(alice, bob, 'MKT', 'member');

      const res = await god.api.god.users({ userId: bob.id }).get();

      expect(res.status).toBe(200);
      expect(res.data?.teams[0]).toMatchObject({
        teamKey: 'MKT',
        role: 'member',
        ownerCount: 1,
      });
    });

    it('counts every owner of a shared team', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await joinTeam(alice, bob, 'MKT', 'owner');

      const res = await god.api.god.users({ userId: alice.id }).get();

      expect(res.data?.teams[0]).toMatchObject({ role: 'owner', ownerCount: 2 });
    });

    it('returns an account with no memberships as reachable by nothing', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });

      const res = await god.api.god.users({ userId: alice.id }).get();

      expect(res.status).toBe(200);
      expect(res.data?.teams).toEqual([]);
      expect(res.data?.teamCount).toBe(0);
    });

    it('404s for an unknown id', async () => {
      const { god } = await setup();

      const res = await god.api.god.users({ userId: '00000000-0000-4000-8000-000000000000' }).get();

      expect(res.status).toBe(404);
    });
  });

  describe('verify email — POST /god/users/:userId/verify-email', () => {
    it('404s for an unknown id', async () => {
      const { god } = await setup();

      const res = await god.api.god
        .users({ userId: '00000000-0000-4000-8000-000000000000' })
        ['verify-email'].post();

      expect(res.status).toBe(404);
    });
  });

  describe('delete — DELETE /god/users/:userId', () => {
    it('removes an account that owns nothing on its own', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });

      const res = await god.api.god.users({ userId: alice.id }).delete();

      expect(res.status).toBe(204);
      expect((await god.api.god.users({ userId: alice.id }).get()).status).toBe(404);
      expect((await god.api.god.users.get({ query: ALL })).data?.total).toBe(1);
    });

    it('removes an account whose teams still have another owner', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await joinTeam(alice, bob, 'MKT', 'owner');

      const res = await god.api.god.users({ userId: alice.id }).delete();

      expect(res.status).toBe(204);
      // MKT survives with Bob as its remaining owner.
      const remaining = await god.api.god.users({ userId: bob.id }).get();
      expect(remaining.data?.teams).toHaveLength(1);
      expect(remaining.data?.teams[0]).toMatchObject({ teamKey: 'MKT', ownerCount: 1 });
    });

    it('refuses to delete the instance owner', async () => {
      const { god } = await setup();

      const res = await god.api.god.users({ userId: god.id }).delete();

      expect(res.status).toBe(403);
      expect((await god.api.god.users({ userId: god.id }).get()).status).toBe(200);
    });

    it('refuses when the account is the only owner of a team', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await joinTeam(alice, bob, 'MKT', 'member');

      const res = await god.api.god.users({ userId: alice.id }).delete();

      expect(res.status).toBe(400);
      // The message names the teams standing in the way.
      expect(JSON.stringify(res.error?.value)).toContain('MKT');
      // Neither the account nor the team was touched.
      expect((await god.api.god.users({ userId: alice.id }).get()).status).toBe(200);
      expect((await god.api.god.users({ userId: bob.id }).get()).data?.teams).toHaveLength(1);
    });

    it('deletes the sole-owned teams with the account when asked', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      await alice.api.teams.post({ key: 'MKT', name: 'Marketing' });
      await joinTeam(alice, bob, 'MKT', 'member');

      const res = await god.api.god
        .users({ userId: alice.id })
        .delete(undefined, { query: { withTeams: true } });

      expect(res.status).toBe(204);
      expect((await god.api.god.users({ userId: alice.id }).get()).status).toBe(404);
      // MKT went with the account, so Bob's membership went with it.
      const remaining = await god.api.god.users({ userId: bob.id }).get();
      expect(remaining.data?.teams).toEqual([]);
      expect(remaining.data?.teamCount).toBe(0);
    });

    it('leaves teams the account only shares alone', async () => {
      const { god } = await setup();
      const alice = await addUser({ email: 'alice@example.com' });
      const bob = await addUser({ email: 'bob@example.com' });
      // Bob owns OPS; Alice is only a member there, so it is not hers to take down.
      await bob.api.teams.post({ key: 'OPS', name: 'Operations' });
      await joinTeam(bob, alice, 'OPS', 'member');

      const res = await god.api.god
        .users({ userId: alice.id })
        .delete(undefined, { query: { withTeams: true } });

      expect(res.status).toBe(204);
      const remaining = await god.api.god.users({ userId: bob.id }).get();
      expect(remaining.data?.teams).toHaveLength(1);
      expect(remaining.data?.teams[0]).toMatchObject({ teamKey: 'OPS' });
    });

    it('404s for an unknown id', async () => {
      const { god } = await setup();

      const res = await god.api.god
        .users({ userId: '00000000-0000-4000-8000-000000000000' })
        .delete();

      expect(res.status).toBe(404);
    });
  });
});

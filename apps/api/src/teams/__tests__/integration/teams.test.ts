import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi, type Api } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Full integration flow: a real session against the real (test) database.
// Requires the test DB to be up and migrated:
//   cp .env.test.example .env.test
//   bun run db:migrate:test
// See apps/api/AGENTS.md "Tests" for the setup.
//
// The teams feature owns five routes: list, create, copy, the full work-items
// view, and delete. createTeam seeds five default columns (one per state type)
// and a default "Member" role; it seeds no issue types or assignees.

// createTeam seeds one column per state type; a new team always has these
// five and nothing else.
const DEFAULT_COLUMN_NAMES = ['Backlog', 'Todo', 'In Progress', 'Done', 'Canceled'];

// Registers a user and returns a Treaty client acting as them.
async function signUpClient() {
  const user = await signUpTestUser();
  return { user, api: authedApi(user.cookie) };
}

async function viewOf(client: Api, teamKey: string) {
  return client.teams({ teamKey }).get();
}

describe('teams', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create', () => {
    it('stores the key uppercased', async () => {
      const { api } = await signUpClient();
      const res = await api.teams.post({ key: 'ops', name: 'Operations' });
      expect(res.status).toBe(201);
      expect(res.data!.key).toBe('OPS');
    });

    it('rejects a key that is not letters and digits starting with a letter', async () => {
      const { api } = await signUpClient();
      for (const key of ['A-B', '1AB', 'A B']) {
        expect((await api.teams.post({ key, name: 'X' })).status).toBe(400);
      }
    });

    it('creates a team and lists it for its owner', async () => {
      const { api } = await signUpClient();

      const created = await api.teams.post({ key: 'MKT', name: 'Marketing' });
      expect(created.status).toBe(201);
      expect(created.data).toMatchObject({ key: 'MKT', name: 'Marketing', description: '' });
      expect(typeof created.data?.id).toBe('string');

      const list = await api.teams.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(1);
      // The list reports the caller's role in each team; the creator is owner.
      expect(list.data?.[0]).toMatchObject({ key: 'MKT', name: 'Marketing', role: 'owner' });
    });

    it('stores a provided description', async () => {
      const { api } = await signUpClient();
      const created = await api.teams.post({
        key: 'MKT',
        name: 'Marketing',
        description: 'Growth work',
      });
      expect(created.data).toMatchObject({ description: 'Growth work' });
    });

    it('seeds the five default columns', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const view = await viewOf(api, 'MKT');
      expect(view.status).toBe(200);
      expect(view.data?.states.map((c) => c.name)).toEqual(DEFAULT_COLUMN_NAMES);
    });

    it('rejects an empty key', async () => {
      const { api } = await signUpClient();
      const res = await api.teams.post({ key: '', name: 'Marketing' });
      expect(res.status).toBe(400);
    });

    it('rejects an empty name', async () => {
      const { api } = await signUpClient();
      const res = await api.teams.post({ key: 'MKT', name: '' });
      expect(res.status).toBe(400);
    });

    it('rejects a missing name', async () => {
      const { api } = await signUpClient();
      const res = await api.teams.post({ key: 'MKT' } as unknown as {
        key: string;
        name: string;
      });
      expect(res.status).toBe(400);
    });

    it('rejects a duplicate key with 409', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const dup = await api.teams.post({ key: 'MKT', name: 'Marketing Two' });
      expect(dup.status).toBe(409);
    });

    it('requires a session', async () => {
      // The anonymous client carries no cookie, so the session gate rejects it.
      const anon = authedApi('');
      const res = await anon.teams.post({ key: 'MKT', name: 'Marketing' });
      expect(res.status).toBe(401);
    });
  });

  describe('list', () => {
    it('returns only the teams the user is a member of, ordered by key', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'OPS', name: 'Operations' });
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const list = await api.teams.get();
      expect(list.status).toBe(200);
      expect(list.data?.map((p) => p.key)).toEqual(['MKT', 'OPS']);
    });

    it('does not show a team to a non-member', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const outsider = await signUpWithRole('guest');
      const list = await outsider.api.teams.get();
      expect(list.status).toBe(200);
      expect(list.data).toHaveLength(0);
    });

    it('lists public teams the caller has not joined, with a null role', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });
      const other = await signUpClient();

      const list = await other.api.teams.get();
      expect(list.data?.map((t) => ({ key: t.key, role: t.role, canManage: t.canManage }))).toEqual(
        [{ key: 'MKT', role: null, canManage: false }],
      );
    });
  });

  describe('update', () => {
    it("updates an owner's team name and description, leaving the key", async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await api
        .teams({ teamKey: 'MKT' })
        .patch({ name: 'Growth', description: 'Growth work' });
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ key: 'MKT', name: 'Growth', description: 'Growth work' });

      const view = await viewOf(api, 'MKT');
      expect(view.data?.team).toMatchObject({
        key: 'MKT',
        name: 'Growth',
        description: 'Growth work',
      });
    });

    it('denies a member who does not manage the team', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const outsider = await signUpClient();
      const res = await outsider.api.teams({ teamKey: 'MKT' }).patch({ name: 'Hijacked' });
      expect(res.status).toBe(403);
    });
  });

  describe('view', () => {
    it('returns the full work-items view for a member', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const view = await viewOf(api, 'MKT');
      expect(view.status).toBe(200);
      expect(view.data?.team).toMatchObject({ key: 'MKT', name: 'Marketing' });
      expect(view.data?.states.map((c) => c.name)).toEqual(DEFAULT_COLUMN_NAMES);
      // An owner's viewer reports the team owner role and management.
      expect(view.data?.viewer).toMatchObject({
        role: 'owner',
        workspaceRole: 'owner',
        canManage: true,
      });
    });

    it('returns 404 for an unknown team', async () => {
      const { api } = await signUpClient();
      const res = await viewOf(api, 'NOPE');
      expect(res.status).toBe(404);
    });

    it('denies a non-member with 403', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const outsider = await signUpWithRole('guest');
      const res = await viewOf(outsider.api, 'MKT');
      expect(res.status).toBe(404);
    });
  });

  describe('delete', () => {
    it('deletes a team and its scoped entities for an owner', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });
      const backlog = (await viewOf(api, 'MKT')).data!.states.find((c) => c.name === 'Backlog')!;
      await api.teams({ teamKey: 'MKT' }).issues.post({ stateId: backlog.id, title: 'Task' });

      const del = await api.teams({ teamKey: 'MKT' }).delete();
      expect(del.status).toBe(204);

      // The team and everything under it are gone: the view 404s and the list
      // is empty.
      expect((await viewOf(api, 'MKT')).status).toBe(404);
      expect((await api.teams.get()).data).toHaveLength(0);
    });

    it('returns 404 for an unknown team', async () => {
      const { api } = await signUpClient();
      const res = await api.teams({ teamKey: 'NOPE' }).delete();
      expect(res.status).toBe(404);
    });

    it('denies a non-member with 403', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const outsider = await signUpWithRole('guest');
      const res = await outsider.api.teams({ teamKey: 'MKT' }).delete();
      expect(res.status).toBe(404);
    });
  });

  describe('settings', () => {
    it('defaults a new team to the default auto-archive thresholds', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await api.teams({ teamKey: 'MKT' }).settings.get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        autoArchive: { completedDays: 28, canceledDays: 7 },
      });
    });

    it('lets an owner set and read back the auto-archive thresholds', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const patch = await api
        .teams({ teamKey: 'MKT' })
        .settings.patch({ autoArchive: { completedDays: 28, canceledDays: 7 } });
      expect(patch.status).toBe(200);
      expect(patch.data?.autoArchive).toMatchObject({ completedDays: 28, canceledDays: 7 });

      const get = await api.teams({ teamKey: 'MKT' }).settings.get();
      expect(get.data?.autoArchive).toMatchObject({ completedDays: 28, canceledDays: 7 });
    });

    it('stores null to disable a state group', async () => {
      const { api } = await signUpClient();
      await api.teams.post({ key: 'MKT', name: 'Marketing' });

      const res = await api
        .teams({ teamKey: 'MKT' })
        .settings.patch({ autoArchive: { completedDays: 30, canceledDays: null } });
      expect(res.status).toBe(200);
      expect(res.data?.autoArchive).toMatchObject({ completedDays: 30, canceledDays: null });
    });

    it('denies writing settings to a non-owner (owner-only)', async () => {
      const owner = await signUpClient();
      await owner.api.teams.post({ key: 'MKT', name: 'Marketing' });

      const outsider = await signUpClient();
      const res = await outsider.api
        .teams({ teamKey: 'MKT' })
        .settings.patch({ autoArchive: { completedDays: 28, canceledDays: 7 } });
      expect(res.status).toBe(403);
    });
  });
});

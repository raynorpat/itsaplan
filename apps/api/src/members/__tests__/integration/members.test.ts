import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Integration coverage for the members feature: listing a team's members, making a
// member a team owner (team managers only), and removing a member or leaving the
// team. New members join through invites, so the tests add a second member by
// creating and accepting an invite. Real sessions against the real (test)
// database. See apps/api/AGENTS.md "Tests" for setup.

type Actor = { user: TestUser; api: ReturnType<typeof authedApi> };

// Creates a team MKT owned by a fresh user and returns a Treaty client acting as
// that owner. The first user in a reset DB is the workspace owner.
async function setupOwner(): Promise<Actor> {
  const user = await signUpTestUser();
  const api = authedApi(user.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  return { user, api };
}

// Adds a fresh workspace member to MKT as a team owner or member by inviting them
// and accepting on their behalf.
async function addMember(owner: Actor, role: 'owner' | 'member' = 'member'): Promise<Actor> {
  const user = await signUpTestUser();
  const created = await owner.api
    .teams({ teamKey: 'MKT' })
    .invites.post({ email: user.email, role });
  const api = authedApi(user.cookie);
  await api.invites({ token: created.data!.token }).accept.post();
  return { user, api };
}

describe('members', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('list — GET /teams/:teamKey/members', () => {
    it('lists the owner alone on a fresh team', async () => {
      const owner = await setupOwner();

      const res = await owner.api.teams({ teamKey: 'MKT' }).members.get();

      expect(res.status).toBe(200);
      expect(res.data).toHaveLength(1);
      expect(res.data?.[0]).toMatchObject({
        userId: owner.user.userId,
        email: owner.user.email,
        role: 'owner',
      });
    });

    it('lists an added member, ordered by join time, for any member', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await member.api.teams({ teamKey: 'MKT' }).members.get();

      expect(res.status).toBe(200);
      expect(res.data?.map((m) => m.userId)).toEqual([owner.user.userId, member.user.userId]);
      expect(res.data?.find((m) => m.userId === member.user.userId)).toMatchObject({
        role: 'member',
      });
    });

    it('hides a private team from a non-member with 404', async () => {
      const owner = await setupOwner();
      await owner.api.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' });
      const outsider = authedApi((await signUpTestUser()).cookie);

      const res = await outsider.teams({ teamKey: 'MKT' }).members.get();
      expect(res.status).toBe(404);
    });
  });

  describe('team owner — PATCH /teams/:teamKey/members/:userId', () => {
    it('promotes a member to team owner', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .patch({ role: 'owner' });
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      const row = list.data?.find((m) => m.userId === member.user.userId);
      expect(row).toMatchObject({ role: 'owner' });
    });

    it('demotes a team owner to member', async () => {
      const owner = await setupOwner();
      const other = await addMember(owner, 'owner');

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: other.user.userId })
        .patch({ role: 'member' });
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      expect(list.data?.find((m) => m.userId === other.user.userId)).toMatchObject({
        role: 'member',
      });
    });

    it('returns 404 for a userId that is not a member', async () => {
      const owner = await setupOwner();
      const stranger = await signUpTestUser();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: stranger.userId })
        .patch({ role: 'member' });
      expect(res.status).toBe(404);
    });

    it('refuses to change your own role with 400', async () => {
      const owner = await setupOwner();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: owner.user.userId })
        .patch({ role: 'member' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when role is missing from the body', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        // @ts-expect-error — role is required
        .patch({});
      expect(res.status).toBe(400);
    });

    it('denies a member who does not manage the team with 403', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);
      const other = await addMember(owner);

      const res = await member.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: other.user.userId })
        .patch({ role: 'owner' });
      expect(res.status).toBe(403);
    });
  });

  describe('description — PATCH /teams/:teamKey/members/:userId/description', () => {
    it("defaults a member's description to empty", async () => {
      const owner = await setupOwner();

      const res = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      expect(res.data?.[0]).toMatchObject({ description: '' });
    });

    it("lets an owner set a member's description", async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .description.patch({ description: 'Backend engineer' });
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      const row = list.data?.find((m) => m.userId === member.user.userId);
      expect(row).toMatchObject({ description: 'Backend engineer' });
    });

    it('clears a description with an empty string', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);
      await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .description.patch({ description: 'QA' });

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .description.patch({ description: '' });
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      const row = list.data?.find((m) => m.userId === member.user.userId);
      expect(row).toMatchObject({ description: '' });
    });

    it('404s for a non-member userId', async () => {
      const owner = await setupOwner();
      const stranger = await signUpTestUser();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: stranger.userId })
        .description.patch({ description: 'x' });
      expect(res.status).toBe(404);
    });

    it('lets a member set their own description', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await member.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .description.patch({ description: 'I do the docs' });
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      const row = list.data?.find((m) => m.userId === member.user.userId);
      expect(row).toMatchObject({ description: 'I do the docs' });
    });

    it("denies a member editing another member's description with 403", async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);
      const other = await addMember(owner);

      const res = await member.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: other.user.userId })
        .description.patch({ description: 'not yours' });
      expect(res.status).toBe(403);
    });
  });

  describe('remove — DELETE /teams/:teamKey/members/:userId', () => {
    it('lets an owner remove a member, revoking their access to a private team', async () => {
      const owner = await setupOwner();
      await owner.api.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' });
      const member = await addMember(owner);

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .delete();
      expect(res.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      expect(list.data?.map((m) => m.userId)).toEqual([owner.user.userId]);

      // The removed member can no longer reach the team.
      const gone = await member.api.teams({ teamKey: 'MKT' }).get();
      expect(gone.status).toBe(404);
    });

    it('lets a member remove themselves (leave the team)', async () => {
      const owner = await setupOwner();
      await owner.api.teams({ teamKey: 'MKT' }).patch({ visibility: 'private' });
      const member = await addMember(owner);

      const res = await member.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .delete();
      expect(res.status).toBe(204);

      const gone = await member.api.teams({ teamKey: 'MKT' }).get();
      expect(gone.status).toBe(404);
    });

    it('denies a member removing another member with 403', async () => {
      const owner = await setupOwner();
      const a = await addMember(owner);
      const b = await addMember(owner);

      const res = await a.api.teams({ teamKey: 'MKT' }).members({ userId: b.user.userId }).delete();
      expect(res.status).toBe(403);

      // b is still a member.
      const list = await owner.api.teams({ teamKey: 'MKT' }).members.get();
      expect(list.data?.map((m) => m.userId)).toContain(b.user.userId);
    });

    it('returns 404 when the userId is not a member', async () => {
      const owner = await setupOwner();
      const stranger = await signUpTestUser();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: stranger.userId })
        .delete();
      expect(res.status).toBe(404);
    });

    it('lets the last team owner leave; the members then manage the team', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: owner.user.userId })
        .delete();
      expect(res.status).toBe(204);
      const view = await member.api.teams({ teamKey: 'MKT' }).get();
      expect(view.data?.viewer.canManage).toBe(true);
    });

    it('lets an owner leave when another owner remains', async () => {
      const owner = await setupOwner();
      await addMember(owner, 'owner');

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .members({ userId: owner.user.userId })
        .delete();
      expect(res.status).toBe(204);
    });

    it('denies a non-member of a public team with 403', async () => {
      const owner = await setupOwner();
      const member = await addMember(owner);
      const outsider = authedApi((await signUpTestUser()).cookie);

      const res = await outsider
        .teams({ teamKey: 'MKT' })
        .members({ userId: member.user.userId })
        .delete();
      expect(res.status).toBe(403);
    });
  });
});

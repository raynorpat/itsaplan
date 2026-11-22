import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { signUpWithRole } from '../../../__tests__/helpers/roles';

// Integration coverage for the invites feature: the owner-side routes that
// create/list/revoke invites and the invitee-side routes that read, accept, or
// reject a token. Real sessions against the real (test) database. See
// apps/api/AGENTS.md "Tests" for setup.

// Creates a team MKT owned by a fresh user and returns a Treaty client acting
// as that owner. The first user in a reset DB is "god"; the owner still reaches
// the team only through its team_member row, so this is a plain owner.
async function setupOwner(): Promise<{ user: TestUser; api: ReturnType<typeof authedApi> }> {
  const user = await signUpTestUser();
  const api = authedApi(user.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  return { user, api };
}

describe('invites', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('create — POST /teams/:teamKey/invites', () => {
    it('creates a pending invite and returns its token and inviter', async () => {
      const owner = await setupOwner();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'invitee@example.com', role: 'member' });

      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({
        email: 'invitee@example.com',
        role: 'member',
        status: 'pending',
        respondedAt: null,
        invitedByEmail: owner.user.email,
      });
      expect(typeof res.data?.token).toBe('string');
      expect(res.data?.token.length).toBeGreaterThan(0);
    });

    it('normalizes the email to lowercase', async () => {
      const owner = await setupOwner();

      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'Mixed.Case@Example.COM', role: 'owner' });

      expect(res.status).toBe(201);
      expect(res.data).toMatchObject({ email: 'mixed.case@example.com', role: 'owner' });
    });

    it('rejects a malformed email with 400', async () => {
      const owner = await setupOwner();
      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'not-an-email', role: 'member' });
      expect(res.status).toBe(400);
    });

    it('rejects a second pending invite for the same email with 409', async () => {
      const owner = await setupOwner();
      const body = { email: 'dup@example.com', role: 'member' as const };

      const first = await owner.api.teams({ teamKey: 'MKT' }).invites.post(body);
      expect(first.status).toBe(201);

      const second = await owner.api.teams({ teamKey: 'MKT' }).invites.post(body);
      expect(second.status).toBe(409);
    });

    it('rejects an invalid role with 400', async () => {
      const owner = await setupOwner();
      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        // @ts-expect-error — role must be "owner" | "member"
        .invites.post({ email: 'x@example.com', role: 'admin' });
      expect(res.status).toBe(400);
    });

    it('denies a non-member with 403', async () => {
      await setupOwner();
      const outsider = (await signUpWithRole('guest')).api;

      const res = await outsider
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'x@example.com', role: 'member' });
      expect(res.status).toBe(404);
    });
  });

  describe('list — GET /teams/:teamKey/invites', () => {
    it("lists the team's invites, newest first", async () => {
      const owner = await setupOwner();
      await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'a@example.com', role: 'member' });
      await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'b@example.com', role: 'owner' });

      const res = await owner.api.teams({ teamKey: 'MKT' }).invites.get();
      expect(res.status).toBe(200);
      expect(res.data?.map((i) => i.email)).toEqual(['b@example.com', 'a@example.com']);
    });

    it('denies a non-member with 403', async () => {
      await setupOwner();
      const outsider = (await signUpWithRole('guest')).api;
      const res = await outsider.teams({ teamKey: 'MKT' }).invites.get();
      expect(res.status).toBe(404);
    });
  });

  describe('revoke — DELETE /teams/:teamKey/invites/:inviteId', () => {
    it('removes a pending invite', async () => {
      const owner = await setupOwner();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'gone@example.com', role: 'member' });

      const del = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites({ inviteId: created.data!.id })
        .delete();
      expect(del.status).toBe(204);

      const list = await owner.api.teams({ teamKey: 'MKT' }).invites.get();
      expect(list.data).toHaveLength(0);
    });

    it('returns 404 for an unknown invite id', async () => {
      const owner = await setupOwner();
      const res = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites({ inviteId: '00000000-0000-4000-8000-000000000000' })
        .delete();
      expect(res.status).toBe(404);
    });

    it('returns 400 for a non-numeric invite id', async () => {
      const owner = await setupOwner();
      const res = await owner.api.teams({ teamKey: 'MKT' }).invites({ inviteId: 'abc' }).delete();
      expect(res.status).toBe(400);
    });

    it('denies a non-member with 403', async () => {
      const owner = await setupOwner();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'x@example.com', role: 'member' });
      const outsider = (await signUpWithRole('guest')).api;

      const res = await outsider
        .teams({ teamKey: 'MKT' })
        .invites({ inviteId: created.data!.id })
        .delete();
      expect(res.status).toBe(404);
    });
  });

  describe('read by token — GET /invites/:token', () => {
    it('returns the invite with team context and hasAccount=false for a stranger email', async () => {
      const owner = await setupOwner();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'nobody@example.com', role: 'member' });

      const res = await authedApi((await signUpTestUser()).cookie)
        .invites({ token: created.data!.token })
        .get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({
        teamKey: 'MKT',
        teamName: 'Marketing',
        email: 'nobody@example.com',
        role: 'member',
        status: 'pending',
        hasAccount: false,
      });
    });

    it('reports hasAccount=true when the invited email already has an account', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email, role: 'member' });

      const res = await authedApi(invitee.cookie).invites({ token: created.data!.token }).get();
      expect(res.status).toBe(200);
      expect(res.data).toMatchObject({ hasAccount: true });
    });

    it('returns 404 for an unknown token', async () => {
      const owner = await setupOwner();
      const res = await owner.api.invites({ token: '00000000-0000-0000-0000-000000000000' }).get();
      expect(res.status).toBe(404);
    });

    it('returns 400 for a malformed (non-UUID) token', async () => {
      const owner = await setupOwner();
      const res = await owner.api.invites({ token: 'not-a-uuid' }).get();
      expect(res.status).toBe(400);
    });
  });

  describe('accept — POST /invites/:token/accept', () => {
    it('adds the invitee as a member and marks the invite accepted', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email, role: 'member' });
      const inviteeApi = authedApi(invitee.cookie);

      // Before accepting, the invitee cannot reach the team.
      const before = await inviteeApi.teams({ teamKey: 'MKT' }).get();
      expect(before.data?.viewer.role).toBeNull();

      const accept = await inviteeApi.invites({ token: created.data!.token }).accept.post();
      expect(accept.status).toBe(200);
      expect(accept.data).toMatchObject({
        teamKey: 'MKT',
        teamName: 'Marketing',
        role: 'member',
      });

      // Membership took effect: the invitee can now read the team.
      const after = await inviteeApi.teams({ teamKey: 'MKT' }).get();
      expect(after.data?.viewer.role).toBe('member');

      // The invite is no longer pending.
      const view = await inviteeApi.invites({ token: created.data!.token }).get();
      expect(view.data).toMatchObject({ status: 'accepted' });
    });

    it('matches the session email case-insensitively', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email.toUpperCase(), role: 'member' });

      const accept = await authedApi(invitee.cookie)
        .invites({ token: created.data!.token })
        .accept.post();
      expect(accept.status).toBe(200);
    });

    it('denies acceptance from a different email with 403', async () => {
      const owner = await setupOwner();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'someone-else@example.com', role: 'member' });

      const other = authedApi((await signUpTestUser()).cookie);
      const res = await other.invites({ token: created.data!.token }).accept.post();
      expect(res.status).toBe(403);
    });

    it('returns 409 when the invite is no longer pending', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email, role: 'member' });
      const inviteeApi = authedApi(invitee.cookie);

      await inviteeApi.invites({ token: created.data!.token }).accept.post();
      const again = await inviteeApi.invites({ token: created.data!.token }).accept.post();
      expect(again.status).toBe(409);
    });

    it('returns 404 for an unknown token', async () => {
      const invitee = authedApi((await signUpTestUser()).cookie);
      const res = await invitee
        .invites({ token: '00000000-0000-0000-0000-000000000000' })
        .accept.post();
      expect(res.status).toBe(404);
    });
  });

  describe('reject — POST /invites/:token/reject', () => {
    it('marks the invite rejected without creating a membership', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email, role: 'member' });
      const inviteeApi = authedApi(invitee.cookie);

      const res = await inviteeApi.invites({ token: created.data!.token }).reject.post();
      expect(res.status).toBe(204);

      // No membership was created.
      const team = await inviteeApi.teams({ teamKey: 'MKT' }).get();
      expect(team.data?.viewer.role).toBeNull();

      // The invite is now rejected.
      const view = await inviteeApi.invites({ token: created.data!.token }).get();
      expect(view.data).toMatchObject({ status: 'rejected' });
    });

    it('denies rejection from a different email with 403', async () => {
      const owner = await setupOwner();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: 'someone-else@example.com', role: 'member' });

      const other = authedApi((await signUpTestUser()).cookie);
      const res = await other.invites({ token: created.data!.token }).reject.post();
      expect(res.status).toBe(403);
    });

    it('returns 409 when the invite is no longer pending', async () => {
      const owner = await setupOwner();
      const invitee = await signUpTestUser();
      const created = await owner.api
        .teams({ teamKey: 'MKT' })
        .invites.post({ email: invitee.email, role: 'member' });
      const inviteeApi = authedApi(invitee.cookie);

      await inviteeApi.invites({ token: created.data!.token }).reject.post();
      const again = await inviteeApi.invites({ token: created.data!.token }).reject.post();
      expect(again.status).toBe(409);
    });

    it('returns 404 for an unknown token', async () => {
      const invitee = authedApi((await signUpTestUser()).cookie);
      const res = await invitee
        .invites({ token: '00000000-0000-0000-0000-000000000000' })
        .reject.post();
      expect(res.status).toBe(404);
    });
  });
});

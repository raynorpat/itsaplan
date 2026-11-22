import { describe, it, expect, beforeEach } from 'bun:test';
import { authedApi } from '../../../__tests__/helpers/app';
import { signUpTestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';

// Integration coverage for the shared access layer — the guard macros
// (permission / teamMember / teamOwner / entityGuard) and the access.ts
// primitives that resolve membership and enforce the role permission matrix.
// These are exercised here through real routes that use each macro, rather than
// re-tested incidentally in every feature. s3.ts is covered by the attachments
// feature; auth-context is covered by the 401 cases throughout.

type Owner = { api: ReturnType<typeof authedApi> };

async function setupOwnerTeam(): Promise<Owner> {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  await api.teams.post({ key: 'MKT', name: 'Marketing' });
  return { api };
}

// Adds a member to team MKT through the real invite flow (owner invites →
// invitee accepts), optionally assigning a custom role. Returns a Treaty client
// acting as the new member.
async function addMember(
  owner: Owner,
  opts: { roleId?: string } = {},
): Promise<{ userId: string; api: ReturnType<typeof authedApi> }> {
  const user = await signUpTestUser();
  const invite = await owner.api
    .teams({ teamKey: 'MKT' })
    .invites.post({ email: user.email, role: 'member' });
  const api = authedApi(user.cookie);
  await api.invites({ token: invite.data!.token }).accept.post();
  if (opts.roleId != null) {
    await owner.api
      .teams({ teamKey: 'MKT' })
      .members({ userId: user.userId })
      .patch({ role: 'member', roleId: opts.roleId });
  }
  return { userId: user.userId, api };
}

describe('shared access', () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe('permission macro and the matrix', () => {
    it('lets an owner bypass the matrix but holds a default member to it', async () => {
      const owner = await setupOwnerTeam();
      const member = await addMember(owner);

      // Owner: allowed on a resource the default member role denies (webhooks).
      const ownerCreate = await owner.api
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] });
      expect(ownerCreate.status).toBe(201);

      // Default member: granted work_items (the team view) ...
      const view = await member.api.teams({ teamKey: 'MKT' }).get();
      expect(view.status).toBe(200);

      // ... but denied on webhooks, which the default role does not grant.
      const list = await member.api.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(403);
      const create = await member.api
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] });
      expect(create.status).toBe(403);
    });

    it("resolves and enforces a custom role's matrix", async () => {
      const owner = await setupOwnerTeam();
      // A role that grants reading webhooks but not creating them.
      const role = await owner.api
        .teams({ teamKey: 'MKT' })
        .roles.post({ name: 'Auditor', permissions: { webhooks: { read: true, create: false } } });
      const member = await addMember(owner, { roleId: role.data!.id });

      const list = await member.api.teams({ teamKey: 'MKT' }).webhooks.get();
      expect(list.status).toBe(200);

      const create = await member.api
        .teams({ teamKey: 'MKT' })
        .webhooks.post({ url: 'https://example.com/h', resourceTypes: ['Issue'] });
      expect(create.status).toBe(403);
    });
  });

  describe('teamMember macro', () => {
    it('allows any member and rejects a non-member', async () => {
      const owner = await setupOwnerTeam();
      const member = await addMember(owner);

      const asMember = await member.api.teams({ teamKey: 'MKT' }).roles.get();
      expect(asMember.status).toBe(200);

      const outsider = authedApi((await signUpTestUser()).cookie);
      const asOutsider = await outsider.teams({ teamKey: 'MKT' }).roles.get();
      expect(asOutsider.status).toBe(403);
    });
  });

  describe('teamOwner macro', () => {
    it('allows the owner and rejects a non-owner member', async () => {
      const owner = await setupOwnerTeam();
      const member = await addMember(owner);

      const asOwner = await owner.api
        .teams({ teamKey: 'MKT' })
        .roles.post({ name: 'Ops', permissions: {} });
      expect(asOwner.status).toBe(201);

      const asMember = await member.api
        .teams({ teamKey: 'MKT' })
        .roles.post({ name: 'Sneaky', permissions: {} });
      expect(asMember.status).toBe(403);
    });
  });

  it('returns 404 for an unknown team before checking access', async () => {
    const owner = await setupOwnerTeam();
    const res = await owner.api.teams({ teamKey: 'NOPE' }).roles.get();
    expect(res.status).toBe(404);
  });
});

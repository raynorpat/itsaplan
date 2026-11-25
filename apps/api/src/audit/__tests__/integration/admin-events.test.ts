import { beforeEach, describe, expect, it } from 'bun:test';
import { auditEntry, db } from '@repo/db';
import { asc, eq } from 'drizzle-orm';
import { signUpTestUser, type TestUser } from '../../../__tests__/helpers/auth';
import { resetDb } from '../../../__tests__/helpers/db';
import { addMember, createTeam, gqlData, makePrivate } from '../../../__tests__/helpers/graphql';
import {
  authorizeCode,
  authPost,
  createClient,
  install,
  uninstall,
} from '../../../__tests__/helpers/oauth';

// People, team, integration and settings events: each admin action leaves an audit
// entry naming who did it and what changed, written with the action, and no secret is
// ever in an entry.

type Row = typeof auditEntry.$inferSelect;

async function rows(type: string): Promise<Row[]> {
  return db
    .select()
    .from(auditEntry)
    .where(eq(auditEntry.type, type))
    .orderBy(asc(auditEntry.createdAt));
}

async function only(type: string): Promise<Row> {
  const found = await rows(type);
  expect(found).toHaveLength(1);
  return found[0]!;
}

const meta = (row: Row) => (row.metadata ?? {}) as Record<string, unknown>;

// An endpoint's JSON answer; the tests read only the fields they assert.
type Json = { [key: string]: Json } & string;

async function ok(res: Response): Promise<Json> {
  if (res.status !== 200) throw new Error(`${res.status}: ${await res.text()}`);
  return (await res.json()) as Json;
}

let owner: TestUser;
let member: TestUser;

beforeEach(async () => {
  await resetDb();
  owner = await signUpTestUser({ name: 'Olive Owner' });
  member = await signUpTestUser({ name: 'Mo Member' });
});

describe('people and roles', () => {
  it('records a role change with its from and to, and owner changes', async () => {
    await gqlData(
      { cookie: owner.cookie },
      `mutation { userChangeRole(id: "${member.userId}", role: admin) { success } }`,
    );
    const changed = await only('userRoleChanged');
    expect(changed.actorId).toBe(owner.userId);
    expect(meta(changed)).toMatchObject({
      entityType: 'user',
      entityId: member.userId,
      from: 'member',
      to: 'admin',
    });

    await gqlData(
      { cookie: owner.cookie },
      `mutation { userChangeRole(id: "${member.userId}", role: owner) { success } }`,
    );
    expect(meta(await only('ownerAdded'))).toMatchObject({ entityId: member.userId });
    await gqlData(
      { cookie: owner.cookie },
      `mutation { userChangeRole(id: "${member.userId}", role: user) { success } }`,
    );
    expect(meta(await only('ownerRemoved'))).toMatchObject({ entityId: member.userId });
  });

  it('leaves no entry when the role change is refused (same transaction)', async () => {
    // The only owner cannot step down: the change rolls back, and its entry with it.
    const res = await gqlData(
      { cookie: owner.cookie },
      `mutation { userChangeRole(id: "${owner.userId}", role: user) { success } }`,
    ).catch((err: unknown) => err);
    expect(res).toBeInstanceOf(Error);
    expect(await rows('userRoleChanged')).toHaveLength(0);
    expect(await rows('ownerRemoved')).toHaveLength(0);
  });

  it('records suspensions and restores', async () => {
    await gqlData(
      { cookie: owner.cookie },
      `mutation { userSuspend(id: "${member.userId}") { success } }`,
    );
    expect(meta(await only('userSuspended'))).toMatchObject({ entityId: member.userId });
    await gqlData(
      { cookie: owner.cookie },
      `mutation { userUnsuspend(id: "${member.userId}") { success } }`,
    );
    expect(meta(await only('userUnsuspended'))).toMatchObject({ entityId: member.userId });
  });

  it('records invites created, revoked and accepted, without the invite token', async () => {
    const created = await gqlData(
      { cookie: owner.cookie },
      `mutation { organizationInviteCreate(input: { email: "ivy@invited.test", role: user }) {
        organizationInvite { id metadata } } }`,
    );
    const invite = created.organizationInviteCreate.organizationInvite;
    const entry = await only('inviteCreated');
    expect(meta(entry)).toMatchObject({ email: 'ivy@invited.test', role: 'member' });
    expect(JSON.stringify(entry)).not.toContain(invite.metadata.token);

    const ivy = await signUpTestUser({ email: 'ivy@invited.test' });
    const accepted = await only('inviteAccepted');
    expect(accepted.actorId).toBe(ivy.userId);
    expect(meta(accepted)).toMatchObject({ email: 'ivy@invited.test', role: 'member' });

    const second = await gqlData(
      { cookie: owner.cookie },
      `mutation { organizationInviteCreate(input: { email: "rex@invited.test", role: guest }) {
        organizationInvite { id } } }`,
    );
    await gqlData(
      { cookie: owner.cookie },
      `mutation { organizationInviteDelete(id: "${second.organizationInviteCreate.organizationInvite.id}") { success } }`,
    );
    expect(meta(await only('inviteRevoked'))).toMatchObject({ email: 'rex@invited.test' });
  });
});

describe('teams', () => {
  it('records team create, membership, owner, visibility and delete', async () => {
    const team = await createTeam({ cookie: owner.cookie }, { key: 'OPS', name: 'Ops' });
    expect(meta(await only('teamCreated'))).toMatchObject({
      entityType: 'team',
      entityId: team.team.id,
      name: 'Ops',
      key: 'OPS',
    });

    const membershipId = await addMember({ cookie: owner.cookie }, team.team.id, member.userId);
    expect(meta(await only('teamMemberAdded'))).toMatchObject({
      entityId: team.team.id,
      userId: member.userId,
    });

    await ok(
      await authPost('/instance/team-owner', owner.cookie, {
        teamId: team.team.id,
        userId: member.userId,
        owner: true,
      }),
    );
    expect(meta(await only('teamOwnerChanged'))).toMatchObject({
      entityId: team.team.id,
      userId: member.userId,
      owner: true,
    });

    await makePrivate({ cookie: owner.cookie }, team.team.id);
    expect(meta(await only('teamVisibilityChanged'))).toMatchObject({
      entityId: team.team.id,
      from: 'public',
      to: 'private',
    });

    await gqlData(
      { cookie: owner.cookie },
      `mutation { teamMembershipDelete(id: "${membershipId}") { success } }`,
    );
    expect(meta(await only('teamMemberRemoved'))).toMatchObject({
      entityId: team.team.id,
      userId: member.userId,
    });

    await gqlData(
      { cookie: owner.cookie },
      `mutation { teamDelete(id: "${team.team.id}") { success } }`,
    );
    expect(meta(await only('teamDeleted'))).toMatchObject({ entityId: team.team.id, name: 'Ops' });
  });
});

describe('integrations and keys', () => {
  it('records OAuth application changes without its secret', async () => {
    const client = await createClient(owner.cookie);
    expect(meta(await only('oauthAppCreated'))).toMatchObject({
      entityType: 'oauthApplication',
      entityId: client.clientId,
      name: 'Test App',
    });
    await ok(
      await authPost('/instance/oauth-apps/update', owner.cookie, {
        clientId: client.clientId,
        name: 'Renamed App',
      }),
    );
    expect(meta(await only('oauthAppUpdated'))).toMatchObject({ name: 'Renamed App' });
    const rotated = await ok(
      await authPost('/instance/oauth-apps/rotate-secret', owner.cookie, {
        clientId: client.clientId,
      }),
    );
    const rotation = await only('oauthAppSecretRotated');
    expect(meta(rotation)).toMatchObject({ entityId: client.clientId });
    for (const row of await db.select().from(auditEntry)) {
      expect(JSON.stringify(row)).not.toContain(rotated.clientSecret);
      expect(JSON.stringify(row)).not.toContain(client.clientSecret);
    }
    await ok(
      await authPost('/instance/oauth-apps/archive', owner.cookie, { clientId: client.clientId }),
    );
    expect(meta(await only('oauthAppDeleted'))).toMatchObject({ entityId: client.clientId });
  });

  it('records authorizations, revocations, installs and uninstalls', async () => {
    const client = await createClient(owner.cookie);
    await authorizeCode(member.cookie, client);
    const authorized = await only('oauthAuthorized');
    expect(authorized.actorId).toBe(member.userId);
    expect(meta(authorized)).toMatchObject({ entityId: client.clientId });

    await ok(
      await authPost('/instance/oauth-authorized/revoke', member.cookie, {
        clientId: client.clientId,
      }),
    );
    expect(meta(await only('oauthRevoked'))).toMatchObject({ entityId: client.clientId });

    await install(owner.cookie, client, { publicTeams: true });
    expect(meta(await only('appInstalled'))).toMatchObject({ entityId: client.clientId });
    await ok(await uninstall(owner.cookie, client));
    expect(meta(await only('appUninstalled'))).toMatchObject({ entityId: client.clientId });
  });

  it('records webhook changes without the signing secret', async () => {
    const created = await gqlData(
      { cookie: owner.cookie },
      `mutation { webhookCreate(input: { url: "https://example.com/h", allPublicTeams: true,
        resourceTypes: ["Issue"], secret: "whsec-test-secret" }) { webhook { id } } }`,
    );
    const id = created.webhookCreate.webhook.id;
    const entry = await only('webhookCreated');
    expect(meta(entry)).toMatchObject({ entityType: 'webhook', entityId: id });
    expect(JSON.stringify(entry)).not.toContain('whsec-test-secret');
    await gqlData(
      { cookie: owner.cookie },
      `mutation { webhookUpdate(id: "${id}", input: { enabled: false }) { success } }`,
    );
    expect(meta(await only('webhookUpdated'))).toMatchObject({ entityId: id });
    await gqlData({ cookie: owner.cookie }, `mutation { webhookDelete(id: "${id}") { success } }`);
    expect(meta(await only('webhookDeleted'))).toMatchObject({ entityId: id });
  });

  it('records release access keys without the key', async () => {
    const team = await createTeam({ cookie: owner.cookie }, { key: 'REL', name: 'Rel' });
    const pipeline = await gqlData(
      { cookie: owner.cookie },
      `mutation { releasePipelineCreate(input: { name: "Prod", teamIds: ["${team.team.id}"] }) {
        releasePipeline { id } } }`,
    );
    const pipelineId = pipeline.releasePipelineCreate.releasePipeline.id;
    const created = await ok(
      await authPost('/instance/access-keys/create', owner.cookie, { pipelineId }),
    );
    const entry = await only('releaseAccessKeyCreated');
    expect(meta(entry)).toMatchObject({ pipelineId, entityId: created.accessKey.id });
    expect(JSON.stringify(entry)).not.toContain(created.key);
    await ok(
      await authPost('/instance/access-keys/revoke', owner.cookie, { id: created.accessKey.id }),
    );
    expect(meta(await only('releaseAccessKeyRevoked'))).toMatchObject({
      entityId: created.accessKey.id,
    });
  });

  it('records AI endpoint changes without the API key', async () => {
    await ok(
      await authPost('/instance/ai/save', owner.cookie, {
        baseUrl: 'https://ai.example.com/v1',
        model: 'small-model',
        apiKey: 'sk-very-secret-key',
      }),
    );
    const saved = await only('aiSettingsChanged');
    expect(meta(saved)).toMatchObject({
      baseUrl: 'https://ai.example.com/v1',
      model: 'small-model',
    });
    expect(JSON.stringify(saved)).not.toContain('sk-very-secret-key');
    await ok(await authPost('/instance/ai/delete', owner.cookie, {}));
    expect(await rows('aiSettingsChanged')).toHaveLength(2);
  });
});

describe('workspace settings', () => {
  it('records name and logo changes apart from security settings', async () => {
    await gqlData(
      { cookie: owner.cookie },
      'mutation { organizationUpdate(input: { name: "Acme" }) { success } }',
    );
    expect(meta(await only('organizationUpdated'))).toMatchObject({
      changes: { name: { to: 'Acme' } },
    });
    expect(await rows('securitySettingsChanged')).toHaveLength(0);

    await gqlData(
      { cookie: owner.cookie },
      'mutation { organizationUpdate(input: { allowedFileUploadContentTypes: ["image/*"] }) { success } }',
    );
    const security = meta(await only('securitySettingsChanged')) as {
      changes: { allowedFileUploadContentTypes: { from: string[]; to: string[] } };
    };
    expect(security.changes.allowedFileUploadContentTypes.from).toContain('application/pdf');
    expect(security.changes.allowedFileUploadContentTypes.to).toEqual(['image/*']);
    expect(await rows('organizationUpdated')).toHaveLength(1);
  });

  it('records Customers settings changes', async () => {
    await ok(await authPost('/instance/customers-settings/save', owner.cookie, { enabled: true }));
    expect(meta(await only('customersSettingsChanged'))).toMatchObject({
      changes: { enabled: { from: false, to: true } },
    });
  });
});

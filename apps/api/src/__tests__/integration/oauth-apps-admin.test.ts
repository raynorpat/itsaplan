import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { signUpTestUser, type TestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gql } from '../helpers/linear';
import {
  REDIRECT_URI,
  authGet,
  authPost,
  authorizeRequest,
  bearer,
  clientCredentials,
  createClient,
  install,
  obtainTokens,
  redirectTarget,
  tokenRequest,
  type OAuthClient,
} from '../helpers/oauth';
import { signUpAs } from '../helpers/graphql';

// Managing OAuth applications (admins and owners, /api/auth/instance/oauth-apps*), the
// applications a user has authorized (/api/auth/instance/oauth-authorized*), and what
// happens to an installed application when its installer leaves or is demoted.

const VIEWER = '{ viewer { id app } }';
const ORG_UPDATE = `mutation($input: OrganizationUpdateInput!) {
  organizationUpdate(input: $input) { success }
}`;
const SUSPEND = 'mutation($id: String!) { userSuspend(id: $id) { success } }';
const CHANGE_ROLE = `mutation($id: String!, $role: UserRoleType!) {
  userChangeRole(id: $id, role: $role) { success }
}`;

interface AppView {
  clientId: string;
  name: string;
  description: string | null;
  developer: string | null;
  developerUrl: string | null;
  iconUrl: string | null;
  redirectUris: string[];
  publicClient: boolean;
  clientCredentials: boolean;
  webhookUrl: string | null;
  webhookResourceTypes: string[];
  archived: boolean;
  installation: { publicTeams: boolean; teamIds: string[]; scopes: string[] } | null;
}

async function listApps(cookie: string): Promise<AppView[]> {
  const res = await authGet('/instance/oauth-apps', cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { applications: AppView[] }).applications;
}

async function authorizedApps(cookie: string) {
  const res = await authGet('/instance/oauth-authorized', cookie);
  expect(res.status).toBe(200);
  return ((await res.json()) as { applications: { clientId: string; scopes: string[] }[] })
    .applications;
}

const refresh = (client: OAuthClient, refreshToken: string, secret = client.clientSecret) =>
  tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: secret,
  });

describe('oauth application management', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Owner' });
  });

  it('lets only workspace admins and owners manage applications', async () => {
    const member = await signUpAs('member', { name: 'Member' });
    const client = await createClient(owner.cookie);
    const create = await authPost('/instance/oauth-apps/create', member.cookie, {
      name: 'Nope',
      redirectUris: [REDIRECT_URI],
    });
    expect(create.status).toBe(403);
    expect((await authGet('/instance/oauth-apps', member.cookie)).status).toBe(403);
    for (const path of ['update', 'rotate-secret', 'rotate-webhook-secret', 'archive'])
      expect(
        (
          await authPost(`/instance/oauth-apps/${path}`, member.cookie, {
            clientId: client.clientId,
          })
        ).status,
      ).toBe(403);
    expect((await authGet('/instance/oauth-apps', null)).status).toBe(401);

    // The OAuth plugin's own client endpoints are not reachable.
    const plugin = await authPost('/oauth2/create-client', owner.cookie, {
      redirect_uris: [REDIRECT_URI],
    });
    expect(plugin.status).toBe(404);

    // A request with the session cookie must come from the app's origin.
    const foreign = await app.handle(
      new Request('http://localhost/api/auth/instance/oauth-apps/create', {
        method: 'POST',
        headers: {
          cookie: owner.cookie,
          origin: 'https://evil.example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: 'Evil', redirectUris: [REDIRECT_URI] }),
      }),
    );
    expect(foreign.status).toBe(403);
  });

  it('shows secrets only on create and rotate, and lists admin applications only', async () => {
    const res = await authPost('/instance/oauth-apps/create', owner.cookie, {
      name: 'Robot',
      description: 'Does things',
      developer: 'Acme',
      developerUrl: 'https://acme.example.com',
      iconUrl: 'https://acme.example.com/icon.png',
      redirectUris: [REDIRECT_URI],
      clientCredentials: true,
      webhookUrl: 'https://hooks.example.com/linear',
      webhookResourceTypes: ['Issue', 'Comment'],
    });
    expect(res.status).toBe(200);
    const created = (await res.json()) as {
      application: AppView;
      clientSecret: string;
      webhookSecret: string;
    };
    expect(created.clientSecret.startsWith('itpcs_')).toBe(true);
    expect(created.webhookSecret.length).toBeGreaterThan(20);
    expect(created.application).toMatchObject({
      name: 'Robot',
      description: 'Does things',
      developer: 'Acme',
      developerUrl: 'https://acme.example.com',
      iconUrl: 'https://acme.example.com/icon.png',
      redirectUris: [REDIRECT_URI],
      publicClient: false,
      clientCredentials: true,
      webhookUrl: 'https://hooks.example.com/linear',
      webhookResourceTypes: ['Issue', 'Comment'],
      archived: false,
      installation: null,
    });

    // An MCP client registering itself is not one of the workspace's applications.
    const reg = await app.handle(
      new Request('http://localhost/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI], token_endpoint_auth_method: 'none' }),
      }),
    );
    expect(reg.status).toBeLessThan(300);

    const listRes = await authGet('/instance/oauth-apps', owner.cookie);
    const text = await listRes.text();
    expect(text).not.toContain(created.clientSecret);
    expect(text).not.toContain(created.clientSecret.slice('itpcs_'.length));
    expect(text).not.toContain(created.webhookSecret);
    const listed = (JSON.parse(text) as { applications: AppView[] }).applications;
    expect(listed.map((a) => a.clientId)).toEqual([created.application.clientId]);

    // Another admin manages it too.
    const admin = await signUpAs('admin', { name: 'Admin' });
    expect((await listApps(admin.cookie)).length).toBe(1);
  });

  it('edits an application and validates its webhook', async () => {
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const update = (body: Record<string, unknown>) =>
      authPost('/instance/oauth-apps/update', owner.cookie, { clientId: client.clientId, ...body });

    const renamed = await update({ name: 'Robot 2', redirectUris: ['https://b.example.com/cb'] });
    expect(renamed.status).toBe(200);
    const body = (await renamed.json()) as { application: AppView; webhookSecret?: string };
    expect(body.application).toMatchObject({
      name: 'Robot 2',
      redirectUris: ['https://b.example.com/cb'],
    });
    expect(body.webhookSecret).toBeUndefined();

    expect((await update({ webhookUrl: 'http://localhost:9999/hook' })).status).toBe(400);
    expect(
      (await update({ webhookUrl: 'https://hooks.example.com/x', webhookResourceTypes: ['Bogus'] }))
        .status,
    ).toBe(400);
    expect((await update({ redirectUris: [] })).status).toBe(400);

    // Adding a webhook shows its secret once; changing it later does not.
    const added = await update({
      webhookUrl: 'https://hooks.example.com/x',
      webhookResourceTypes: ['Issue'],
    });
    expect(added.status).toBe(200);
    const addedBody = (await added.json()) as { webhookSecret?: string };
    expect(addedBody.webhookSecret).toBeTruthy();
    const changed = (await (await update({ webhookResourceTypes: ['Comment'] })).json()) as {
      application: AppView;
      webhookSecret?: string;
    };
    expect(changed.webhookSecret).toBeUndefined();
    expect(changed.application.webhookResourceTypes).toEqual(['Comment']);

    const rotated = await authPost('/instance/oauth-apps/rotate-webhook-secret', owner.cookie, {
      clientId: client.clientId,
    });
    expect(rotated.status).toBe(200);
    const fresh = ((await rotated.json()) as { webhookSecret: string }).webhookSecret;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(addedBody.webhookSecret);

    // Removing the webhook.
    const removed = (await (await update({ webhookUrl: null })).json()) as {
      application: AppView;
    };
    expect(removed.application.webhookUrl).toBeNull();

    const unknown = await authPost('/instance/oauth-apps/update', owner.cookie, {
      clientId: 'nope',
      name: 'x',
    });
    expect(unknown.status).toBe(404);
  });

  it('makes a rotated client secret fail at once and revokes client_credentials tokens', async () => {
    const client = await createClient(owner.cookie, { clientCredentials: true });
    await install(owner.cookie, client);
    const tokens = await obtainTokens(owner.cookie, client, 'read');
    const m2m = (await (await clientCredentials(client)).json()) as { access_token: string };

    const rotated = await authPost('/instance/oauth-apps/rotate-secret', owner.cookie, {
      clientId: client.clientId,
    });
    const fresh = ((await rotated.json()) as { clientSecret: string }).clientSecret;
    expect((await refresh(client, tokens.refresh_token!)).status).toBe(401);
    expect((await refresh(client, tokens.refresh_token!, fresh)).status).toBe(200);
    // Linear: rotating the secret revokes the client_credentials tokens.
    expect((await gql(bearer(m2m.access_token), VIEWER)).status).toBe(401);

    const publicClient = await createClient(owner.cookie, { publicClient: true });
    const refused = await authPost('/instance/oauth-apps/rotate-secret', owner.cookie, {
      clientId: publicClient.clientId,
    });
    expect(refused.status).toBe(400);
  });

  it('archives an application: its tokens stop working and it cannot be authorized', async () => {
    const client = await createClient(owner.cookie, { clientCredentials: true });
    const installed = await install(owner.cookie, client);
    const tokens = await obtainTokens(owner.cookie, client, 'read');

    const archived = await authPost('/instance/oauth-apps/archive', owner.cookie, {
      clientId: client.clientId,
    });
    expect(archived.status).toBe(200);
    for (const token of [installed.access_token, tokens.access_token])
      expect((await gql(bearer(token), VIEWER)).status).toBe(401);
    expect((await refresh(client, tokens.refresh_token!)).status).not.toBe(200);
    expect((await clientCredentials(client)).status).not.toBe(200);

    const authorize = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
    });
    const target = await redirectTarget(authorize).catch(() => '');
    expect(target).not.toContain('code=');

    const [listed] = await listApps(owner.cookie);
    expect(listed).toMatchObject({ archived: true, installation: null });
  });

  it('lists the installation of an installed application', async () => {
    const client = await createClient(owner.cookie);
    await install(owner.cookie, client, { scope: 'read,write,app:assignable' });
    const [listed] = await listApps(owner.cookie);
    expect(listed!.installation).toMatchObject({
      publicTeams: true,
      teamIds: [],
      scopes: ['read', 'write', 'app:assignable'],
    });
    await authPost('/instance/oauth-uninstall', owner.cookie, { clientId: client.clientId });
    expect((await listApps(owner.cookie))[0]!.installation).toBeNull();
  });
});

describe('authorized applications', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists and revokes the user's own authorizations only", async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const member = await signUpAs('member', { name: 'Member' });
    const client = await createClient(owner.cookie, { name: 'Robot' });

    const mine = await obtainTokens(member.cookie, client, 'read,write');
    const theirs = await obtainTokens(owner.cookie, client, 'read');
    const installed = await install(owner.cookie, client);

    const listed = await authorizedApps(member.cookie);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ clientId: client.clientId, name: 'Robot' });
    expect(listed[0]!.scopes.sort()).toEqual(['read', 'write']);

    const revoked = await authPost('/instance/oauth-authorized/revoke', member.cookie, {
      clientId: client.clientId,
    });
    expect(revoked.status).toBe(200);
    expect((await gql(bearer(mine.access_token), VIEWER)).status).toBe(401);
    expect((await refresh(client, mine.refresh_token!)).status).not.toBe(200);
    expect(await authorizedApps(member.cookie)).toHaveLength(0);
    // Consent is asked again.
    const again = await redirectTarget(
      await authorizeRequest(member.cookie, {
        client_id: client.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'read',
      }),
    );
    expect(again).not.toContain('code=');

    // Other people's authorizations and the install are untouched.
    expect((await gql(bearer(theirs.access_token), VIEWER)).status).toBe(200);
    expect((await gql(bearer(installed.access_token), VIEWER)).status).toBe(200);

    // The installing admin revoking their own authorization keeps the install.
    const ownerRevoke = await authPost('/instance/oauth-authorized/revoke', owner.cookie, {
      clientId: client.clientId,
    });
    expect(ownerRevoke.status).toBe(200);
    expect((await gql(bearer(theirs.access_token), VIEWER)).status).toBe(401);
    expect((await gql(bearer(installed.access_token), VIEWER)).status).toBe(200);
    expect(
      (await authorizedApps(owner.cookie)).find((a) => a.clientId === client.clientId),
    ).toBeUndefined();
  });
});

describe('an installed application when its installer changes', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps working after the installer is suspended or demoted', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const admin = await signUpAs('admin', { name: 'Admin' });
    const client = await createClient(admin.cookie, { clientCredentials: true });
    const installed = await install(admin.cookie, client);
    const appUserId = (
      (await gql(bearer(installed.access_token), VIEWER)).body.data?.viewer as {
        id: string;
      }
    ).id;
    const adminToken = await obtainTokens(admin.cookie, client, 'read,write,admin');
    expect(
      (await gql(bearer(adminToken.access_token), ORG_UPDATE, { input: { name: 'Renamed' } })).body
        .errors,
    ).toBeUndefined();

    // Demoted: the app keeps working; the admin's own token loses its admin rights.
    const demoted = await gql({ cookie: owner.cookie }, CHANGE_ROLE, {
      id: admin.userId,
      role: 'user',
    });
    expect(demoted.body.errors).toBeUndefined();
    expect(
      (await gql(bearer(installed.access_token), VIEWER)).body.data?.viewer as { id: string },
    ).toMatchObject({ id: appUserId });
    const refused = await gql(bearer(adminToken.access_token), ORG_UPDATE, {
      input: { name: 'Again' },
    });
    expect(refused.body.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

    // Suspended: the app keeps working (access, refresh, client_credentials); the
    // suspended person's own token stops.
    const suspended = await gql({ cookie: owner.cookie }, SUSPEND, { id: admin.userId });
    expect(suspended.body.errors).toBeUndefined();
    expect((await gql(bearer(installed.access_token), VIEWER)).status).toBe(200);
    const refreshed = await refresh(client, installed.refresh_token!);
    expect(refreshed.status).toBe(200);
    const next = (await refreshed.json()) as { access_token: string };
    expect(
      (await gql(bearer(next.access_token), VIEWER)).body.data?.viewer as { id: string },
    ).toMatchObject({ id: appUserId });
    expect((await clientCredentials(client)).status).toBe(200);
    expect((await gql(bearer(adminToken.access_token), VIEWER)).status).toBe(401);
  });
});

describe('the application shown on the consent page', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('shows a signed-in person the application, and nothing to anyone else', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const member = await signUpAs('member', { name: 'Member' });
    const client = await createClient(owner.cookie, {
      name: 'Robot',
      description: 'Ships things',
      developer: 'Acme',
      developerUrl: 'https://acme.example',
      iconUrl: 'https://acme.example/icon.png',
    });

    const res = await authGet(`/instance/oauth-client?clientId=${client.clientId}`, member.cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      clientId: client.clientId,
      name: 'Robot',
      description: 'Ships things',
      developer: 'Acme',
      developerUrl: 'https://acme.example',
      iconUrl: 'https://acme.example/icon.png',
      application: true,
    });

    expect((await authGet(`/instance/oauth-client?clientId=${client.clientId}`, null)).status).toBe(
      401,
    );
    expect((await authGet('/instance/oauth-client?clientId=missing', member.cookie)).status).toBe(
      404,
    );
    await authPost('/instance/oauth-apps/archive', owner.cookie, { clientId: client.clientId });
    expect(
      (await authGet(`/instance/oauth-client?clientId=${client.clientId}`, member.cookie)).status,
    ).toBe(404);
  });
});

describe('oauth application rules', () => {
  let owner: TestUser;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser({ name: 'Owner' });
  });

  it('applies one redirect URI rule on create and update', async () => {
    const create = (extra: Record<string, unknown>) =>
      authPost('/instance/oauth-apps/create', owner.cookie, { name: 'Native', ...extra });
    expect((await create({ redirectUris: ['http://evil.example.com/cb'] })).status).toBe(400);
    expect((await create({ redirectUris: ['http://localhost:8787/cb'] })).status).toBe(200);
    // A custom scheme is for a native (public) application only.
    expect((await create({ redirectUris: ['myapp://callback'] })).status).toBe(400);
    expect((await create({ redirectUris: ['myapp://callback'], publicClient: true })).status).toBe(
      200,
    );
    expect((await create({ redirectUris: ['javascript://x'], publicClient: true })).status).toBe(
      400,
    );

    const client = await createClient(owner.cookie, { name: 'Robot' });
    const update = (uris: string[]) =>
      authPost('/instance/oauth-apps/update', owner.cookie, {
        clientId: client.clientId,
        redirectUris: uris,
      });
    expect((await update(['http://evil.example.com/cb'])).status).toBe(400);
    expect((await update(['myapp://callback'])).status).toBe(400);
    expect((await update(['http://127.0.0.1:9000/cb'])).status).toBe(200);
  });

  it('stops client_credentials tokens when the grant is turned off', async () => {
    const client = await createClient(owner.cookie, { name: 'Robot', clientCredentials: true });
    await install(owner.cookie, client);
    const res = await clientCredentials(client);
    expect(res.status).toBe(200);
    const token = ((await res.json()) as { access_token: string }).access_token;
    expect((await gql(bearer(token), VIEWER)).body.data?.viewer).toBeTruthy();
    const off = await authPost('/instance/oauth-apps/update', owner.cookie, {
      clientId: client.clientId,
      clientCredentials: false,
    });
    expect(off.status).toBe(200);
    expect((await gql(bearer(token), VIEWER)).status).toBe(401);
  });

  it('refuses a cookie-authenticated registration from another origin', async () => {
    const res = await app.handle(
      new Request('http://localhost/api/auth/oauth2/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: owner.cookie,
          origin: 'https://evil.example.com',
        },
        body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'bun:test';
import { oauthIssuer } from '@repo/auth';
import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { app } from '../../app';
import { setWorkspaceRole } from '../../shared/access';
import { authedApi } from '../helpers/app';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import { gql } from '../helpers/linear';
import {
  REDIRECT_URI,
  bearer,
  consentAsApp,
  createClient,
  install,
  obtainTokens,
  pkce,
  redirectTarget,
  tokenRequest,
  uninstall,
} from '../helpers/oauth';
import { addToTeam, signUpWithRole } from '../helpers/roles';

// How the OAuth endpoints identify the client of a request, and the install checks
// that depend on it: client credentials are read exactly as the OAuth plugin reads
// them; malformed credentials are the client's error; an install code is checked
// against its installer on every attempt; a reinstall does not revive tokens of the
// previous install.

const VIEWER = '{ viewer { id app } }';

function post(path: string, headers: Record<string, string>, body: Record<string, string>) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

async function errorOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { error?: string }).error;
}

describe('oauth client authentication', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('reads client credentials the way the token endpoint does', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await authedApi(owner.cookie).teams.post({ key: 'MKT', name: 'Marketing' });
    const a = await createClient(owner.cookie, { name: 'A' });
    const b = await createClient(owner.cookie, { name: 'B', clientCredentials: true });
    await install(owner.cookie, a, { scope: 'read,write' });
    await install(owner.cookie, b, { scope: 'read' });
    // A lowercase `basic` header is not client authentication to the plugin, which
    // reads the body (B); the install checked must be B's, so `write` is refused.
    const res = await post(
      '/oauth/token',
      { authorization: `basic ${btoa(`${a.clientId}:x`)}` },
      {
        grant_type: 'client_credentials',
        client_id: b.clientId,
        client_secret: b.clientSecret,
        scope: 'read write',
      },
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('invalid_scope');
  });

  it('answers malformed Basic credentials with invalid_client on every grant', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const { verifier } = pkce();
    const tokens = await obtainTokens(owner.cookie, client, 'read');
    for (const body of <Record<string, string>[]>[
      {
        grant_type: 'authorization_code',
        code: 'anything',
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      },
      { grant_type: 'refresh_token', refresh_token: tokens.refresh_token ?? 'itpr_x' },
      { grant_type: 'client_credentials' },
    ]) {
      for (const basic of ['!!!!', btoa('no-colon'), btoa(':secret'), btoa('id:')]) {
        const res = await post('/oauth/token', { authorization: `Basic ${basic}` }, body);
        expect(res.status).toBe(400);
        expect(await errorOf(res)).toBe('invalid_client');
      }
    }
    for (const path of ['/oauth/revoke', '/api/auth/oauth2/introspect']) {
      const res = await post(path, { authorization: 'Basic !!!!' }, { token: tokens.access_token });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe('invalid_client');
    }
  });

  it('checks the installer again when an install code is retried', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const admin = await signUpWithRole('admin', { name: 'Admin' });
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const { verifier, challenge } = pkce();
    const consent = await consentAsApp(admin.cookie, client, challenge);
    expect(consent.status).toBe(200);
    const code = new URL(await redirectTarget(consent)).searchParams.get('code')!;
    // The first attempt fails at the plugin before it uses the code (no client
    // secret and no code verifier), after the install checks have passed.
    const first = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
    });
    expect(first.status).toBe(400);
    await setWorkspaceRole(admin.userId, 'member');
    const retry = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
    });
    expect(retry.status).toBe(400);
    expect(await errorOf(retry)).toBe('invalid_grant');
  });

  it('does not revive tokens of a previous install on reinstall', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    await authedApi(owner.cookie).teams.post({ key: 'MKT', name: 'Marketing' });
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const first = await install(owner.cookie, client);
    const appUserId = (
      (await gql(bearer(first.access_token), VIEWER)).body.data?.viewer as {
        id: string;
      }
    ).id;
    expect((await uninstall(owner.cookie, client)).status).toBe(200);
    // A token the OAuth plugin wrote just after the uninstall committed (an exchange
    // that passed its checks before the uninstall).
    const raw = randomBytes(32).toString('base64url');
    const now = new Date();
    await db.insert(schema.oauthAccessToken).values({
      token: createHash('sha256').update(raw).digest('base64url'),
      clientId: client.clientId,
      userId: appUserId,
      scopes: ['read', 'write', 'actor:app'],
      createdAt: now,
      expiresAt: new Date(now.getTime() + 3600_000),
    });
    const late = `itpo_${raw}`;
    expect((await gql(bearer(late), VIEWER)).status).toBe(401);
    await install(owner.cookie, client);
    expect((await gql(bearer(late), VIEWER)).status).toBe(401);
  });

  it('refuses a person adding an app user to a team they cannot manage with 403', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const api = authedApi(owner.cookie);
    await api.teams.post({ key: 'MKT', name: 'Marketing' });
    await api.teams.post({ key: 'SEC', name: 'Security' });
    await api.teams({ teamKey: 'SEC' }).patch({ visibility: 'private' });
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const tokens = await install(owner.cookie, client);
    const appUserId = (
      (await gql(bearer(tokens.access_token), VIEWER)).body.data?.viewer as {
        id: string;
      }
    ).id;
    // A member of the private team, who cannot add people to it: the refusal is the
    // permission's (403), not a message that reveals the user is an app user.
    const member = await signUpWithRole('member', { name: 'Member' });
    await addToTeam(api, 'SEC', member);
    const res = await member.api.teams({ teamKey: 'SEC' }).members.post({ userId: appUserId });
    expect(res.status).toBe(403);
  });

  it("uses the plugin's loopback rule for the issuer", () => {
    expect(oauthIssuer('http://api.localhost:3000')).toBe('http://api.localhost:3000');
    expect(oauthIssuer('http://127.0.0.5:3000/')).toBe('http://127.0.0.5:3000');
    expect(oauthIssuer('http://localhost:3100')).toBe('http://localhost:3100');
    expect(oauthIssuer('http://planner.lan')).toBe('https://planner.lan');
    expect(oauthIssuer('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('keeps the uninstall of an application workspace-wide', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const client = await createClient(owner.cookie, { name: 'Robot' });
    const personal = await obtainTokens(owner.cookie, client, 'read');
    await install(owner.cookie, client);
    expect((await uninstall(owner.cookie, client)).status).toBe(200);
    // Linear revokes an uninstalled application for the whole workspace, personal
    // authorizations included.
    expect((await gql(bearer(personal.access_token), VIEWER)).status).toBe(401);
  });
});

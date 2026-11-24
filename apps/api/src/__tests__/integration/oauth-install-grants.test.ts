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
  createClient,
  install,
  obtainTokens,
  redirectTarget,
  tokenRequest,
  type OAuthClient,
  type TokenSet,
} from '../helpers/oauth';
import { createTeam } from '../helpers/graphql';

// The grants of an `actor=app` install belong to the application's app user, not to
// the admin who installed it: a refresh, with any scope, keeps acting as the app user,
// and the admin's own authorization of the same application is a separate grant
// (consent, tokens, refresh family). One issuer is used everywhere.

const VIEWER = '{ viewer { id app admin } }';
const TEAM = 'query($id: String!) { team(id: $id) { id } }';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  await createTeam(owner, { key: 'MKT', name: 'Marketing' });
  await createTeam(owner, { key: 'ENG', name: 'Engineering' });
  const mkt = await gql({ cookie: owner.cookie }, TEAM, { id: 'MKT' });
  const client = await createClient(owner.cookie, { name: 'Robot' });
  return { owner, client, mktId: (mkt.body.data?.team as { id: string }).id };
}

async function viewer(token: string) {
  const res = await gql(bearer(token), VIEWER);
  return res.body.data?.viewer as { id: string; app: boolean; admin: boolean } | undefined;
}

function refresh(client: OAuthClient, refreshToken: string, scope?: string) {
  return tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    ...(scope ? { scope } : {}),
  });
}

async function installOnlyMkt(owner: TestUser, client: OAuthClient, mktId: string) {
  return install(owner.cookie, client, {
    scope: 'read,write,admin',
    teamIds: [mktId],
    publicTeams: false,
  });
}

describe('oauth install grants', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('keeps acting as the app user when a refresh narrows the scope', async () => {
    const { owner, client, mktId } = await setup();
    const tokens = await installOnlyMkt(owner, client, mktId);
    expect(tokens.refresh_token).toBeTruthy();
    for (const scope of ['read', 'read write admin offline_access']) {
      const res = await refresh(client, tokens.refresh_token!, scope);
      // A narrower refresh either keeps the app actor or is refused; it never becomes
      // the installing admin.
      if (res.status !== 200) continue;
      const next = (await res.json()) as TokenSet;
      const me = await viewer(next.access_token);
      expect(me?.id).not.toBe(owner.userId);
      expect(me?.app).toBe(true);
      expect(me?.admin).toBe(false);
      const eng = await gql(bearer(next.access_token), TEAM, { id: 'ENG' });
      expect(eng.body.data?.team ?? null).toBeNull();
      tokens.refresh_token = next.refresh_token ?? tokens.refresh_token;
    }
  });

  it("keeps the admin's own authorization separate from the install", async () => {
    const { owner, client, mktId } = await setup();
    const personal = await obtainTokens(owner.cookie, client, 'read');
    const installTokens = await installOnlyMkt(owner, client, mktId);
    expect((await viewer(personal.access_token))?.id).toBe(owner.userId);
    expect((await viewer(installTokens.access_token))?.app).toBe(true);

    // The admin's personal authorization is listed and survives the install.
    const listed = await authGet('/instance/oauth-authorized', owner.cookie);
    const apps = ((await listed.json()) as { applications: { clientId: string }[] }).applications;
    expect(apps.map((a) => a.clientId)).toContain(client.clientId);

    // A personal authorize after the install is answered from the remembered personal
    // consent, without a consent page.
    const again = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
    });
    expect(new URL(await redirectTarget(again)).searchParams.get('code')).toBeTruthy();

    // Revoking the personal authorization leaves the install working.
    const revoked = await authPost('/instance/oauth-authorized/revoke', owner.cookie, {
      clientId: client.clientId,
    });
    expect(revoked.status).toBe(200);
    expect(await viewer(personal.access_token)).toBeUndefined();
    expect((await viewer(installTokens.access_token))?.app).toBe(true);
  });

  it('does not let refresh reuse on one grant revoke the other', async () => {
    const { owner, client, mktId } = await setup();
    const personal = await obtainTokens(owner.cookie, client, 'read');
    const installTokens = await installOnlyMkt(owner, client, mktId);

    // Reusing the install's refresh token revokes the install's family only.
    expect((await refresh(client, installTokens.refresh_token!)).status).toBe(200);
    expect((await refresh(client, installTokens.refresh_token!)).status).not.toBe(200);
    expect((await viewer(personal.access_token))?.id).toBe(owner.userId);

    // And the other way round.
    const installed = await installOnlyMkt(owner, client, mktId);
    expect((await refresh(client, personal.refresh_token!)).status).toBe(200);
    expect((await refresh(client, personal.refresh_token!)).status).not.toBe(200);
    expect((await viewer(installed.access_token))?.app).toBe(true);
  });

  it('uses one issuer in the metadata and the authorization response', async () => {
    const { owner, client } = await setup();
    const meta = (await (
      await app.handle(new Request('http://localhost/.well-known/oauth-authorization-server'))
    ).json()) as { issuer: string };
    const res = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
      state: 's',
    });
    let target = new URL(await redirectTarget(res));
    if (!target.searchParams.get('code')) {
      const consent = await authPost('/oauth2/consent', owner.cookie, {
        accept: true,
        oauth_query: target.search.slice(1),
      });
      target = new URL(await redirectTarget(consent));
    }
    expect(target.searchParams.get('iss')).toBe(meta.issuer);
    // The plugin's own metadata endpoint is not served with a second issuer.
    const own = await app.handle(
      new Request('http://localhost/api/auth/.well-known/oauth-authorization-server'),
    );
    if (own.status === 200)
      expect(((await own.json()) as { issuer: string }).issuer).toBe(meta.issuer);
  });
  it("treats prompt values other than Linear's consent as absent", async () => {
    const { owner, client } = await setup();
    // Signed in: the request goes on to consent or a code, not back to the sign-in page.
    const res = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
      prompt: 'login',
    });
    const target = new URL(await redirectTarget(res));
    expect(target.pathname).not.toBe('/login');
  });
});

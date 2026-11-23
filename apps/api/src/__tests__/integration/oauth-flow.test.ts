import { beforeEach, describe, expect, it } from 'bun:test';
import { app } from '../../app';
import { createApiKey, gql } from '../helpers/linear';
import { signUpTestUser } from '../helpers/auth';
import { resetDb } from '../helpers/db';
import {
  ORIGIN,
  REDIRECT_URI,
  authPost,
  authorizeCode,
  authorizeRequest,
  createClient,
  obtainTokens,
  pkce,
  redirectTarget,
  tokenRequest,
} from '../helpers/oauth';

// The OAuth server (better-auth's OAuth provider plugin) behind Linear's paths:
// /oauth/authorize, /oauth/token and /oauth/revoke, with Linear's comma-separated
// scopes, PKCE, refresh tokens without offline_access, and dynamic registration for
// MCP clients.

const VIEWER = '{ viewer { id } }';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const client = await createClient(owner.cookie);
  return { owner, client };
}

describe('oauth flow', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('issues a token through /oauth/authorize and /oauth/token that GraphQL accepts', async () => {
    const { owner, client } = await setup();
    const tokens = await obtainTokens(owner.cookie, client, 'read,write');
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token.startsWith('itpo_')).toBe(true);
    expect(tokens.scope.split(' ')).toEqual(expect.arrayContaining(['read', 'write']));
    const res = await gql(bearer(tokens.access_token), VIEWER);
    expect(res.status).toBe(200);
    expect((res.body.data?.viewer as { id: string }).id).toBe(owner.userId);
  });

  it('asks for consent once and remembers it', async () => {
    const { owner, client } = await setup();
    await obtainTokens(owner.cookie, client, 'read');
    const { challenge } = pkce();
    const again = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    expect(new URL(await redirectTarget(again)).searchParams.get('code')).toBeTruthy();
  });

  it('refuses a reused code, a wrong verifier and an unregistered redirect URI', async () => {
    const { owner, client } = await setup();
    const { verifier, challenge } = pkce();
    const code = await authorizeCode(owner.cookie, client, { scope: 'read', challenge });
    const exchange = (c: string, v: string) =>
      tokenRequest({
        grant_type: 'authorization_code',
        code: c,
        redirect_uri: REDIRECT_URI,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code_verifier: v,
      });
    expect((await exchange(code, pkce().verifier)).status).toBeGreaterThanOrEqual(400);
    const code2 = await authorizeCode(owner.cookie, client, { scope: 'read', challenge });
    expect((await exchange(code2, verifier)).status).toBe(200);
    expect((await exchange(code2, verifier)).status).toBeGreaterThanOrEqual(400);

    const bad = await authorizeRequest(owner.cookie, {
      client_id: client.clientId,
      redirect_uri: 'https://evil.example.com/cb',
      response_type: 'code',
      scope: 'read',
    });
    const target = await redirectTarget(bad);
    expect(target.startsWith('https://evil.example.com')).toBe(false);
    expect(target).toContain('invalid_redirect');
  });

  it('lets a confidential application skip PKCE, as Linear does, without a refresh token', async () => {
    const { owner, client } = await setup();
    const code = await authorizeCode(owner.cookie, client, { scope: 'read' });
    const res = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(res.status).toBe(200);
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string };
    expect(tokens.refresh_token).toBeUndefined();
    expect((await gql(bearer(tokens.access_token), VIEWER)).status).toBe(200);
  });

  it('requires PKCE from a public client', async () => {
    const owner = await signUpTestUser({ name: 'Owner' });
    const res = await authPost('/oauth2/create-client', owner.cookie, {
      redirect_uris: [REDIRECT_URI],
      client_name: 'Desktop',
      token_endpoint_auth_method: 'none',
      type: 'native',
    });
    const publicClient = (await res.json()) as { client_id: string };
    const target = await redirectTarget(
      await authorizeRequest(owner.cookie, {
        client_id: publicClient.client_id,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'read',
      }),
    );
    expect(new URL(target).searchParams.get('code')).toBeNull();
    expect(target).toContain('error=invalid_request');
  });

  it('refreshes without offline_access and revokes the previous pair', async () => {
    const { owner, client } = await setup();
    const first = await obtainTokens(owner.cookie, client, 'read');
    expect(first.refresh_token).toBeTruthy();
    const res = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(res.status).toBe(200);
    const second = (await res.json()) as { access_token: string; refresh_token: string };
    expect((await gql(bearer(second.access_token), VIEWER)).status).toBe(200);
    expect((await gql(bearer(first.access_token), VIEWER)).status).toBe(401);
    const reuse = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: first.refresh_token!,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(reuse.status).toBe(400);
  });

  it('revokes a token at /oauth/revoke, Linear style and with client credentials', async () => {
    const { owner, client } = await setup();
    const a = await obtainTokens(owner.cookie, client, 'read');
    const linearStyle = await app.handle(
      new Request('http://localhost/oauth/revoke', {
        method: 'POST',
        headers: bearer(a.access_token),
      }),
    );
    expect(linearStyle.status).toBe(200);
    expect((await gql(bearer(a.access_token), VIEWER)).status).toBe(401);

    const b = await obtainTokens(owner.cookie, client, 'read');
    const form = await app.handle(
      new Request('http://localhost/oauth/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: b.access_token,
          client_id: client.clientId,
          client_secret: client.clientSecret,
        }).toString(),
      }),
    );
    expect(form.status).toBe(200);
    expect((await gql(bearer(b.access_token), VIEWER)).status).toBe(401);
  });

  it('makes a rotated client secret fail at once', async () => {
    const { owner, client } = await setup();
    const tokens = await obtainTokens(owner.cookie, client, 'read');
    const rotated = await authPost('/oauth2/client/rotate-secret', owner.cookie, {
      client_id: client.clientId,
    });
    expect(rotated.status).toBe(200);
    const fresh = ((await rotated.json()) as { client_secret: string }).client_secret;
    expect(fresh).toBeTruthy();
    const withOld = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    });
    expect(withOld.status).toBe(401);
    const withNew = await tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token!,
      client_id: client.clientId,
      client_secret: fresh,
    });
    expect(withNew.status).toBe(200);
  });

  it('refuses consent posted from another site', async () => {
    const { owner, client } = await setup();
    const { challenge } = pkce();
    const consentPage = new URL(
      await redirectTarget(
        await authorizeRequest(owner.cookie, {
          client_id: client.clientId,
          redirect_uri: REDIRECT_URI,
          response_type: 'code',
          scope: 'read',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        }),
      ),
    );
    expect(consentPage.origin + consentPage.pathname).toBe(`${ORIGIN}/oauth/consent`);
    for (const origin of ['https://evil.example.com', null]) {
      const headers = new Headers({ cookie: owner.cookie, 'content-type': 'application/json' });
      if (origin) headers.set('origin', origin);
      const res = await app.handle(
        new Request('http://localhost/api/auth/oauth2/consent', {
          method: 'POST',
          headers,
          body: JSON.stringify({ accept: true, oauth_query: consentPage.search.slice(1) }),
        }),
      );
      expect(res.status).toBe(403);
    }
  });

  it('lets an MCP client register itself with read and write only', async () => {
    const register = (body: Record<string, unknown>) =>
      app.handle(
        new Request('http://localhost/oauth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ redirect_uris: ['http://localhost:7777/callback'], ...body }),
        }),
      );
    await signUpTestUser({ name: 'Owner' });
    expect((await register({ scope: 'read admin' })).status).toBe(400);
    expect((await register({ scope: 'read app:assignable' })).status).toBe(400);
    const res = await register({ client_name: 'Claude' });
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { scope: string; client_secret?: string };
    const scopes = json.scope.split(' ');
    expect(scopes).toEqual(expect.arrayContaining(['read', 'write']));
    expect(scopes).not.toContain('admin');
    expect(json.client_secret).toBeUndefined();
  });

  it('publishes the authorization server metadata with the Linear paths', async () => {
    const res = await app.handle(
      new Request('http://localhost/.well-known/oauth-authorization-server'),
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.authorization_endpoint).toBe(`${process.env.API_URL}/oauth/authorize`);
    expect(meta.token_endpoint).toBe(`${process.env.API_URL}/oauth/token`);
    expect(meta.revocation_endpoint).toBe(`${process.env.API_URL}/oauth/revoke`);
    expect(meta.registration_endpoint).toBe(`${process.env.API_URL}/oauth/register`);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.scopes_supported as string[]).toEqual(
      expect.arrayContaining(['read', 'write', 'issues:create', 'comments:create']),
    );
  });

  it('keeps API keys working next to OAuth tokens', async () => {
    const { owner } = await setup();
    const key = await createApiKey(owner.cookie);
    expect((await gql({ authorization: key }, VIEWER)).status).toBe(200);
    expect((await gql(bearer(key), VIEWER)).status).toBe(200);
    expect((await gql(bearer('itpo_notatoken'), VIEWER)).status).toBe(401);
  });
});

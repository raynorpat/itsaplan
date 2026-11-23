import { createHash, randomBytes } from 'node:crypto';
import { app } from '../../app';

// OAuth flows driven through the in-memory app: an admin registers an application,
// a signed-in user goes through Linear's /oauth/authorize, posts consent the way the
// web's consent page does, and exchanges the code at /oauth/token.

export const ORIGIN = (process.env.APP_URL ?? '').split(',')[0]!.trim();
export const REDIRECT_URI = 'https://client.example.com/callback';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

// POST to a better-auth endpoint with the session cookie from the web's origin.
export async function authPost(path: string, cookie: string | null, body: unknown) {
  const headers = new Headers({ origin: ORIGIN, 'content-type': 'application/json' });
  if (cookie) headers.set('cookie', cookie);
  return app.handle(
    new Request(`http://localhost/api/auth${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}

// An application registered by an admin (confidential: it has a client secret).
export async function createClient(
  adminCookie: string,
  extra: Record<string, unknown> = {},
): Promise<OAuthClient> {
  const res = await authPost('/oauth2/create-client', adminCookie, {
    redirect_uris: [REDIRECT_URI],
    client_name: 'Test App',
    token_endpoint_auth_method: 'client_secret_post',
    ...extra,
  });
  if (res.status !== 200 && res.status !== 201)
    throw new Error(`create-client ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { client_id: string; client_secret: string };
  return { clientId: json.client_id, clientSecret: json.client_secret };
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Where a response sends the browser: a 3xx Location, or better-auth's JSON redirect.
export async function redirectTarget(res: Response): Promise<string> {
  const location = res.headers.get('location');
  if (location) return location;
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { url?: string; redirect_uri?: string };
    if (json.url ?? json.redirect_uri) return (json.url ?? json.redirect_uri)!;
  } catch {
    // fall through
  }
  throw new Error(`no redirect (${res.status}): ${text}`);
}

export function authorizeRequest(
  cookie: string | null,
  params: Record<string, string>,
): Promise<Response> {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return app.handle(
    new Request(`http://localhost/oauth/authorize?${new URLSearchParams(params)}`, { headers }),
  );
}

// Runs authorize and consent for a signed-in user; returns the authorization code.
export async function authorizeCode(
  cookie: string,
  client: OAuthClient,
  opts: { scope?: string; challenge?: string; params?: Record<string, string> } = {},
): Promise<string> {
  const params: Record<string, string> = {
    client_id: client.clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state: 'state-1',
    ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
    ...(opts.challenge ? { code_challenge: opts.challenge, code_challenge_method: 'S256' } : {}),
    ...opts.params,
  };
  let target = new URL(await redirectTarget(await authorizeRequest(cookie, params)));
  if (!target.searchParams.get('code')) {
    // The consent page: accept the requested scopes as the web's page does.
    const consent = await authPost('/oauth2/consent', cookie, {
      accept: true,
      oauth_query: target.search.slice(1),
    });
    target = new URL(await redirectTarget(consent));
  }
  const code = target.searchParams.get('code');
  if (!code) throw new Error(`no code: ${target.toString()}`);
  return code;
}

export async function tokenRequest(body: Record<string, string>): Promise<Response> {
  return app.handle(
    new Request('http://localhost/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    }),
  );
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
}

// The full authorization code flow with PKCE; returns the token response.
export async function obtainTokens(
  cookie: string,
  client: OAuthClient,
  scope = 'read,write',
): Promise<TokenSet> {
  const { verifier, challenge } = pkce();
  const code = await authorizeCode(cookie, client, { scope, challenge });
  const res = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code_verifier: verifier,
  });
  if (res.status !== 200) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()) as TokenSet;
}

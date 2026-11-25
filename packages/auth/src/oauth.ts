import { createHash, randomBytes } from 'node:crypto';
import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { eq } from 'drizzle-orm';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { auditRecord } from './audit';
import { oauthProvider } from '@better-auth/oauth-provider';
import { isLoopbackHost } from '@better-auth/core/utils/host';
import { base64 } from '@better-auth/utils/base64';
import {
  APP_ACTOR_SCOPE,
  activeInstallation,
  installApplication,
  isAppActor,
  isAppUser,
  isWorkspaceAdmin,
  parseTeamSelection,
  type TeamSelection,
} from './oauth-install';

// The OAuth server: better-auth's OAuth provider plugin, with Linear's scopes. The API
// serves Linear's paths (/oauth/authorize, /oauth/token, /oauth/revoke, /oauth/register)
// and forwards them to the plugin's /api/auth/oauth2/* endpoints; the hooks below adapt
// the requests to the plugin, whichever path they came in on.

// Linear's OAuth scopes. `offline_access` is the plugin's switch for refresh tokens;
// Linear clients never send it, so it is added on the way in (oauthBeforeHook).
export const OAUTH_SCOPES = [
  'read',
  'write',
  'issues:create',
  'comments:create',
  'admin',
  'app:assignable',
  'app:mentionable',
] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
const OFFLINE = 'offline_access';

// What an MCP client may ask for when it registers itself, and what it gets when it
// asks for nothing. Never `admin` or the app scopes.
export const MCP_CLIENT_SCOPES = ['read', 'write', 'issues:create', 'comments:create'] as const;
const REGISTRATION_DEFAULT_SCOPES = ['read', 'write', OFFLINE];
const REGISTRATION_ALLOWED_SCOPES = ['issues:create', 'comments:create'];

// Token prefixes, so a token is recognisable in logs and by secret scanners, and an
// OAuth access token is told apart from an API key (`itp_`) by its first characters.
export const OAUTH_ACCESS_TOKEN_PREFIX = 'itpo_';
const REFRESH_TOKEN_PREFIX = 'itpr_';
const CLIENT_SECRET_PREFIX = 'itpcs_';

// Linear accepts scopes separated by commas; the plugin by spaces. Unknown values are
// kept, so the plugin refuses them as invalid scopes.
export function normaliseScopes(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? '').split(/[\s,]+/).filter(Boolean))];
}

// Linear's `read` "will always be present": every grant includes it, so a token
// limited to `issues:create` or `comments:create` can still read what it writes to.
export function withRead(scopes: string[]): string[] {
  return scopes.includes('read') ? scopes : ['read', ...scopes];
}

// Where the browser goes for each step that needs a person: the web's sign-in page
// (which resumes the authorization afterwards) and its consent page.
export function oauthPages(appUrl: string) {
  return { loginPage: `${appUrl}/login`, consentPage: `${appUrl}/oauth/consent` };
}

const isAdminRole = (role: unknown) => role === 'owner' || role === 'admin';

// The issuer, as the plugin writes it into authorization responses (`iss`, RFC 9207)
// and as the API's discovery document states it. This is the plugin's own rule
// (validateIssuerUrl): the API origin, https unless on a loopback host (127/8, ::1,
// localhost and *.localhost), without a trailing slash. Off loopback, OAuth therefore
// needs an https API_URL (mountOAuth warns at startup).
export function oauthIssuer(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.protocol !== 'https:' && !isLoopbackHost(url.host)) url.protocol = 'https:';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

// The consent row a grant is stored under. An `actor=app` install and the same
// person's own authorization of the application are separate grants: separate
// consent rows here, and separate token families because the install's tokens
// belong to the app user (beforeCodeExchange).
const INSTALL_REFERENCE = 'app-install';
const PERSONAL_REFERENCE = 'personal';
const consentReference = (scopes: string[] | undefined) =>
  scopes?.includes(APP_ACTOR_SCOPE) ? INSTALL_REFERENCE : PERSONAL_REFERENCE;

export const oauthPlugins = (appUrl: string, apiUrl: string) => [
  // The provider signs nothing with it for us (access tokens stay opaque, see the
  // `resource` handling in oauthBeforeHook), but it needs the JWT plugin to store
  // client secrets hashed. Its issuer is the one the API's discovery document states.
  jwt({ disableSettingJwtHeader: true, jwt: { issuer: oauthIssuer(apiUrl) } }),
  oauthProvider({
    ...oauthPages(appUrl),
    // Used only for consentReferenceId; nothing redirects to a post-login page.
    postLogin: {
      page: oauthPages(appUrl).consentPage,
      shouldRedirect: () => false,
      consentReferenceId: ({ scopes }) => consentReference(scopes),
    },
    // APP_ACTOR_SCOPE marks the tokens of an `actor=app` install (oauth-install.ts);
    // it is never advertised and never accepted from a client.
    scopes: [...OAUTH_SCOPES, OFFLINE, APP_ACTOR_SCOPE],
    advertisedMetadata: { scopes_supported: [...OAUTH_SCOPES] },
    // Linear's access tokens last a day, refreshed with the refresh token.
    accessTokenExpiresIn: 24 * 3600,
    m2mAccessTokenExpiresIn: 24 * 3600,
    storeClientSecret: 'hashed',
    storeTokens: 'hashed',
    // Dynamic registration is how an MCP client gets its client id. It needs no
    // session (an MCP client has none), gets a public client (no secret, PKCE), and
    // only the scopes above.
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    clientRegistrationDefaultScopes: REGISTRATION_DEFAULT_SCOPES,
    clientRegistrationAllowedScopes: REGISTRATION_ALLOWED_SCOPES,
    // Applications are created and managed by workspace admins and owners only.
    clientPrivileges: ({ user }) => isAdminRole(user?.workspaceRole),
    prefix: {
      opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
      refreshToken: REFRESH_TOKEN_PREFIX,
      clientSecret: CLIENT_SECRET_PREFIX,
    },
    silenceWarnings: { oauthAuthServerConfig: true },
  }),
];

// A cookie-authenticated write must come from the app's own origin (CSRF); better-auth
// does not check the origin on plugin endpoints. Requests without the cookie carry no
// ambient credential. The plugin's client and consent management endpoints are
// disabled (OAUTH_DISABLED_PATHS); applications are managed through the instance
// plugin, which applies the same rule.
const COOKIE_WRITES = new Set(['/oauth2/consent', '/oauth2/continue', '/oauth2/register']);

// The endpoints that authenticate a client, with Basic credentials or in the body.
const CLIENT_AUTH_PATHS = new Set(['/oauth2/token', '/oauth2/revoke', '/oauth2/introspect']);

// The plugin's own client and consent management. Its rules (a client belongs to the
// user who created it) are not the workspace's (any admin manages every application),
// so applications and a user's authorizations are managed through
// /api/auth/instance/oauth-apps* and /instance/oauth-authorized* instead.
export const OAUTH_DISABLED_PATHS = [
  '/oauth2/create-client',
  '/oauth2/get-client',
  '/oauth2/get-clients',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/delete-client',
  '/oauth2/get-consent',
  '/oauth2/get-consents',
  '/oauth2/update-consent',
  '/oauth2/delete-consent',
];

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// Adapts requests for the plugin. Runs in better-auth's `hooks.before`.
export async function oauthBeforeHook(ctx: HookContext, trustedOrigins: string[]): Promise<void> {
  if (COOKIE_WRITES.has(ctx.path) && ctx.headers?.get('cookie')) {
    const origin = ctx.headers.get('origin');
    if (!origin || !trustedOrigins.includes(origin))
      throw new APIError('FORBIDDEN', { message: 'This request must come from the app' });
  }

  if (ctx.path === '/oauth2/authorize') {
    // The plugin also runs the authorize step internally when it resumes a signed
    // request (after consent or sign-in); that query was adapted on its way in and is
    // left as it is.
    if (ctx.request && !new URL(ctx.request.url).pathname.endsWith('/oauth2/authorize')) return;
    const query = (ctx.query ?? {}) as Record<string, unknown>;
    const scopes = withRead(
      normaliseScopes(
        typeof query.scope === 'string' ? query.scope : await defaultScope(query.client_id),
      ),
    );
    // A refresh token is issued with `offline_access`, which the plugin also takes as
    // a demand for PKCE. Add it when the client uses PKCE; a confidential client that
    // does not gets its refresh token from afterToken.
    if (typeof query.code_challenge === 'string' && !scopes.includes(OFFLINE)) scopes.push(OFFLINE);
    // The app actor is asked for with Linear's `actor` parameter, never as a scope.
    const withoutActor = scopes.filter((s) => s !== APP_ACTOR_SCOPE);
    if (isAppActor(query.actor)) withoutActor.push(APP_ACTOR_SCOPE);
    query.scope = withoutActor.join(' ');
    // Linear's authorize takes `prompt=consent` only. The other OpenID values
    // (`login`, `select_account`, `create`) would send the browser to pages the web
    // does not have, so they are dropped; `none` is kept (it fails rather than show a
    // page).
    if (typeof query.prompt === 'string') {
      const kept = query.prompt.split(' ').filter((p) => p === 'consent' || p === 'none');
      if (kept.length > 0) query.prompt = kept.join(' ');
      else delete query.prompt;
    }
    return;
  }

  if (ctx.path === '/oauth2/consent') {
    await beforeConsent(ctx);
    return;
  }

  if (CLIENT_AUTH_PATHS.has(ctx.path)) basicCredentials(ctx);

  if (ctx.path === '/oauth2/token') {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // With `resource` the plugin issues a JWT access token, which cannot be revoked
    // before it expires. Every token here is opaque, so it is dropped.
    delete body.resource;
    if (typeof body.scope === 'string') body.scope = normaliseScopes(body.scope).join(' ');
    if (body.grant_type === 'authorization_code') await beforeCodeExchange(body);
    if (body.grant_type === 'refresh_token') await beforeRefresh(body);
    if (body.grant_type === 'client_credentials') await beforeClientCredentials(ctx, body);
    return;
  }

  if (ctx.path === '/oauth2/register') {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // A self-registered client sets nothing the admins' applications use.
    delete body.metadata;
    if (typeof body.scope === 'string') {
      const scopes = withRead(normaliseScopes(body.scope));
      if (!scopes.includes(OFFLINE)) scopes.push(OFFLINE);
      body.scope = scopes.join(' ');
    }
  }
}

// The scope an authorize request without one gets: Linear's `read` for a workspace
// application; the registered scopes for a self-registered (MCP) client, which asks
// for what it registered with (`read write` by default).
async function defaultScope(clientId: unknown): Promise<string> {
  if (typeof clientId !== 'string') return 'read';
  const [client] = await db
    .select({ scopes: schema.oauthClient.scopes, metadata: schema.oauthClient.metadata })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId));
  if (!client || isWorkspaceApplication(client.metadata)) return 'read';
  const registered = (client.scopes ?? []).filter((s) => s !== OFFLINE);
  return registered.length ? registered.join(' ') : 'read';
}

// The plugin stores a client's metadata as a JSON string inside the jsonb column.
export function clientMetadata(raw: unknown): Record<string, unknown> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Whether a client is one of the workspace's applications (created by an admin), as
// opposed to a client an MCP client registered itself.
export const isWorkspaceApplication = (metadata: unknown) =>
  clientMetadata(metadata).application === true;

// Runs in better-auth's `hooks.after`.
export async function oauthAfterHook(ctx: HookContext): Promise<unknown> {
  if (ctx.path === '/oauth2/consent') return afterConsent(ctx);
  if (ctx.path === '/oauth2/token') return afterToken(ctx);
}

// The JSON body an endpoint answered with, or null when it failed.
async function returnedJson(ctx: HookContext): Promise<Record<string, unknown> | null> {
  const returned = ctx.context.returned as unknown;
  if (returned instanceof APIError || returned instanceof Error) return null;
  if (returned instanceof Response) {
    if (!returned.ok) return null;
    return (await returned
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
  }
  return returned && typeof returned === 'object' ? (returned as Record<string, unknown>) : null;
}

const tokenError = (error: string, description: string) =>
  new APIError('BAD_REQUEST', { error, error_description: description });

// --- actor=app installs (oauth-install.ts) ----------------------------------------

// The scopes a consent request grants: the ones it names, else every requested one.
function consentedScopes(ctx: HookContext): string[] {
  const body = (ctx.body ?? {}) as { scope?: unknown; oauth_query?: unknown };
  if (typeof body.scope === 'string') return body.scope.split(' ').filter(Boolean);
  const query = new URLSearchParams(typeof body.oauth_query === 'string' ? body.oauth_query : '');
  return (query.get('scope') ?? '').split(' ').filter(Boolean);
}

// The install a consent request makes, kept from the before hook (which checks it)
// for the after hook (which applies it once the plugin has accepted the consent).
const pendingInstalls = new WeakMap<object, { userId: string; selection: TeamSelection }>();
const requestKey = (ctx: HookContext): object | null => ctx.request ?? null;

// An accepted consent that grants the app actor: only a workspace admin or owner may
// install, with a valid team selection. The plugin checks the signed query after this
// hook, so nothing is written here.
async function beforeConsent(ctx: HookContext): Promise<void> {
  const body = (ctx.body ?? {}) as { accept?: unknown };
  if (body.accept !== true || !consentedScopes(ctx).includes(APP_ACTOR_SCOPE)) return;
  const session = await getSessionFromCtx(ctx);
  if (!(await isWorkspaceAdmin(session?.user.id)))
    throw new APIError('FORBIDDEN', {
      message: 'Only a workspace admin or owner can install an application',
    });
  const selection = await parseTeamSelection(ctx.body);
  if (typeof selection === 'string') throw new APIError('BAD_REQUEST', { message: selection });
  const key = requestKey(ctx);
  if (key) pendingInstalls.set(key, { userId: session!.user.id, selection });
}

// Installs the application once the plugin has accepted an app-actor consent, and
// records the accepted consent in the audit log (after the plugin's write: there is no
// transaction to share).
async function afterConsent(ctx: HookContext): Promise<void> {
  const key = requestKey(ctx);
  const pending = key ? pendingInstalls.get(key) : undefined;
  if (pending) pendingInstalls.delete(key!);
  if ((ctx.body as { accept?: unknown } | undefined)?.accept !== true) return;
  if (!(await returnedJson(ctx))) return;
  const scopes = consentedScopes(ctx);
  const query = new URLSearchParams(
    String((ctx.body as { oauth_query?: unknown }).oauth_query ?? ''),
  );
  const clientId = query.get('client_id');
  if (!clientId) return;
  const target = { entityType: 'oauthApplication', entityId: clientId };
  if (!pending) {
    const session = await getSessionFromCtx(ctx);
    if (session) await auditRecord('oauthAuthorized', { ...target, scopes }, session.user.id);
    return;
  }
  const appScopes = scopes.filter((s) => s !== APP_ACTOR_SCOPE && s !== OFFLINE);
  await installApplication({
    clientId,
    installedByUserId: pending.userId,
    scopes: appScopes,
    selection: pending.selection,
  });
  await auditRecord(
    'appInstalled',
    {
      ...target,
      scopes: appScopes,
      publicTeams: pending.selection.publicTeams,
      teamIds: pending.selection.teamIds,
    },
    pending.userId,
  );
}

interface PendingAuthorization {
  userId?: string;
  // Set when an install code is rewritten to the app user: who installed it.
  installerId?: string;
  query?: { scope?: string; client_id?: string };
  [key: string]: unknown;
}

// The pending authorization behind a code, read without using it up. The plugin
// stores the code hashed like every token.
async function pendingAuthorization(
  code: string,
): Promise<{ id: string; value: PendingAuthorization } | null> {
  const [row] = await db
    .select({ id: schema.verification.id, value: schema.verification.value })
    .from(schema.verification)
    .where(eq(schema.verification.identifier, hashToken(code)));
  if (!row) return null;
  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch {
    value = null;
  }
  if (!value || typeof value !== 'object')
    throw tokenError('invalid_grant', 'The authorization code is not valid');
  return { id: row.id, value: value as PendingAuthorization };
}

// Every code is looked up here before the plugin uses it, so the app-actor checks
// cannot be skipped: an unknown code is refused here (fail closed), as the plugin
// would refuse it. An app-actor code is exchanged only while the application is
// installed and its installer is still a workspace admin or owner, and its tokens
// are issued to the application's app user, not to the installer, so no later
// request on them (a refresh with fewer scopes, a revoked family) can act as the
// installer or touch the installer's own grant.
async function beforeCodeExchange(body: Record<string, unknown>): Promise<void> {
  if (typeof body.code !== 'string') throw tokenError('invalid_request', 'code is required');
  const pending = await pendingAuthorization(body.code);
  if (!pending) throw tokenError('invalid_grant', 'invalid code');
  const scopes = (pending.value.query?.scope ?? '').split(' ');
  if (!scopes.includes(APP_ACTOR_SCOPE)) return;
  const clientId = pending.value.query?.client_id;
  const installation = clientId ? await activeInstallation(clientId) : null;
  if (!installation) throw tokenError('invalid_grant', 'The application is not installed');
  // A code rewritten by an earlier attempt (that failed at the plugin before it used
  // the code) is checked against the installer it recorded, on every attempt.
  const rewritten = pending.value.userId === installation.appUserId;
  const installerId = rewritten ? pending.value.installerId : pending.value.userId;
  if (!(await isWorkspaceAdmin(installerId)))
    throw tokenError('invalid_grant', 'Only a workspace admin or owner can install an application');
  if (rewritten) return;
  await db
    .update(schema.verification)
    .set({
      value: JSON.stringify({ ...pending.value, userId: installation.appUserId, installerId }),
    })
    .where(eq(schema.verification.id, pending.id));
}

// A refresh keeps what marks its grant: a refresh of an install's token keeps the
// app actor (and `offline_access`, so a narrowed refresh still gets a refresh token),
// and a client cannot add the app actor to any other refresh.
async function beforeRefresh(body: Record<string, unknown>): Promise<void> {
  if (typeof body.scope !== 'string') return;
  const requested = body.scope.split(' ').filter((s) => s && s !== APP_ACTOR_SCOPE);
  const raw = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  const stored = raw.startsWith(REFRESH_TOKEN_PREFIX)
    ? hashToken(raw.slice(REFRESH_TOKEN_PREFIX.length))
    : null;
  const [row] = stored
    ? await db
        .select({ scopes: schema.oauthRefreshToken.scopes })
        .from(schema.oauthRefreshToken)
        .where(eq(schema.oauthRefreshToken.token, stored))
    : [];
  const kept = (row?.scopes ?? []).filter((s) => s === APP_ACTOR_SCOPE || s === OFFLINE);
  body.scope = [...new Set([...requested, ...kept])].join(' ');
}

// A request's Basic client credentials, read exactly as the plugin reads them
// (basicToClientCredentials): only an `Authorization` header that starts with
// `Basic ` (that case), base64-decoded with the same decoder, split at the first
// colon, nothing URL-decoded. Any other header is not client authentication, and the
// plugin reads the body instead. So the client the hooks check is always the client
// the plugin authenticates. Malformed credentials are the client's error
// (invalid_client), never a server error.
function basicCredentials(ctx: HookContext): { clientId: string } | null {
  const authorization = ctx.request?.headers.get('authorization') || null;
  if (!authorization?.startsWith('Basic ')) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(base64.decode(authorization.replace('Basic ', '')));
  } catch {
    throw tokenError('invalid_client', 'Malformed client credentials');
  }
  const separator = decoded.indexOf(':');
  const clientId = separator === -1 ? '' : decoded.slice(0, separator);
  const secret = separator === -1 ? '' : decoded.slice(separator + 1);
  if (!clientId || !secret) throw tokenError('invalid_client', 'Malformed client credentials');
  return { clientId };
}

// The client id of a token request, as the plugin determines it.
function requestClientId(ctx: HookContext, body: Record<string, unknown>): string | null {
  const basic = basicCredentials(ctx);
  if (basic) return basic.clientId;
  return typeof body.client_id === 'string' ? body.client_id : null;
}

// Linear's client_credentials grant gives an installed application a token acting as
// its app user, within the scopes granted at install.
async function beforeClientCredentials(
  ctx: HookContext,
  body: Record<string, unknown>,
): Promise<void> {
  const clientId = requestClientId(ctx, body);
  const installation = clientId ? await activeInstallation(clientId) : null;
  if (!installation) throw tokenError('invalid_grant', 'The application is not installed');
  const requested = normaliseScopes(typeof body.scope === 'string' ? body.scope : '');
  const scopes = withRead(requested.length > 0 ? requested : installation.scopes);
  const beyond = scopes.filter((s) => s !== 'read' && !installation.scopes.includes(s));
  if (beyond.length > 0)
    throw tokenError('invalid_scope', `The installation does not grant ${beyond.join(', ')}`);
  body.scope = [...scopes, APP_ACTOR_SCOPE].join(' ');
}

// The token response lists Linear's scopes only. A confidential application that
// exchanged its code without PKCE gets a refresh token too, as Linear's do: the plugin
// ties refresh tokens to `offline_access`, which it also takes as a demand for PKCE,
// so the refresh token is issued here in the plugin's format (hashed, `itpr_` prefix,
// `offline_access` in its scopes so the plugin rotates it).
async function afterToken(ctx: HookContext): Promise<unknown> {
  const response = await returnedJson(ctx);
  if (!response || typeof response.access_token !== 'string') return;
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (body.grant_type === 'client_credentials')
    await assertIssuedTo(response.access_token, requestClientId(ctx, body));
  const next = { ...response };
  if (typeof next.scope === 'string')
    next.scope = next.scope
      .split(' ')
      .filter((s) => s && s !== OFFLINE && s !== APP_ACTOR_SCOPE)
      .join(' ');
  if (body.grant_type === 'authorization_code' && !next.refresh_token) {
    const refresh = await issueRefreshToken(response.access_token);
    if (refresh) next.refresh_token = refresh;
  }
  return ctx.json(next, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
}

// A client_credentials token must belong to the client whose installation and scopes
// beforeClientCredentials checked. The two read the client the same way
// (requestClientId), so this holds; if they ever disagree, the token is deleted and
// the request refused.
async function assertIssuedTo(accessToken: string, clientId: string | null): Promise<void> {
  if (!accessToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return;
  const hashed = hashToken(accessToken.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));
  const [row] = await db
    .select({ clientId: schema.oauthAccessToken.clientId })
    .from(schema.oauthAccessToken)
    .where(eq(schema.oauthAccessToken.token, hashed));
  if (row && row.clientId === clientId) return;
  await db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.token, hashed));
  throw tokenError('invalid_client', 'The client credentials do not match');
}

const REFRESH_TOKEN_LIFETIME_MS = 30 * 24 * 3600 * 1000;

async function issueRefreshToken(accessToken: string): Promise<string | null> {
  if (!accessToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const hashed = hashToken(accessToken.slice(OAUTH_ACCESS_TOKEN_PREFIX.length));
  const [row] = await db
    .select({
      id: schema.oauthAccessToken.id,
      clientId: schema.oauthAccessToken.clientId,
      userId: schema.oauthAccessToken.userId,
      sessionId: schema.oauthAccessToken.sessionId,
      scopes: schema.oauthAccessToken.scopes,
      refreshId: schema.oauthAccessToken.refreshId,
      clientSecret: schema.oauthClient.clientSecret,
      grantTypes: schema.oauthClient.grantTypes,
    })
    .from(schema.oauthAccessToken)
    .innerJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.oauthAccessToken.clientId),
    )
    .where(eq(schema.oauthAccessToken.token, hashed));
  // Only a confidential application (it has a secret) whose grants include the
  // authorization code, for a token issued to a user without a refresh token.
  if (!row || row.refreshId || !row.userId || !row.clientSecret) return null;
  const grants = row.grantTypes?.length ? row.grantTypes : ['authorization_code'];
  if (!grants.includes('authorization_code')) return null;
  const raw = randomBytes(32).toString('base64url');
  const now = new Date();
  const [refresh] = await db
    .insert(schema.oauthRefreshToken)
    .values({
      token: hashToken(raw),
      clientId: row.clientId,
      sessionId: row.sessionId,
      userId: row.userId,
      scopes: [...row.scopes.filter((s) => s !== OFFLINE), OFFLINE],
      createdAt: now,
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS),
    })
    .returning({ id: schema.oauthRefreshToken.id });
  await db
    .update(schema.oauthAccessToken)
    .set({ refreshId: refresh!.id })
    .where(eq(schema.oauthAccessToken.id, row.id));
  return REFRESH_TOKEN_PREFIX + raw;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

// A new client secret: the value shown once (with its prefix) and the stored hash, in
// the plugin's format (SHA-256, base64url, of the value without its prefix).
export function newClientSecret(): { secret: string; stored: string } {
  const raw = randomBytes(32).toString('base64url');
  return { secret: CLIENT_SECRET_PREFIX + raw, stored: hashToken(raw) };
}

export interface OAuthGrant {
  // The user the token acts for: the app user for a token of an `actor=app` install.
  userId: string;
  clientId: string;
  scopes: OAuthScope[];
  actor: 'user' | 'app';
}

// The grant behind an OAuth access token, or null when the token is unknown, expired,
// revoked (directly, or by refreshing or revoking its refresh token), its application
// is disabled, or it belongs to an `actor=app` install that is no longer installed.
// The plugin stores a SHA-256 (base64url) hash of the token without its prefix.
export async function resolveOAuthAccessToken(token: string): Promise<OAuthGrant | null> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return null;
  const [row] = await db
    .select({
      userId: schema.oauthAccessToken.userId,
      clientId: schema.oauthAccessToken.clientId,
      scopes: schema.oauthAccessToken.scopes,
      expiresAt: schema.oauthAccessToken.expiresAt,
      refreshRevoked: schema.oauthRefreshToken.revoked,
      clientDisabled: schema.oauthClient.disabled,
    })
    .from(schema.oauthAccessToken)
    .innerJoin(
      schema.oauthClient,
      eq(schema.oauthClient.clientId, schema.oauthAccessToken.clientId),
    )
    .leftJoin(
      schema.oauthRefreshToken,
      eq(schema.oauthRefreshToken.id, schema.oauthAccessToken.refreshId),
    )
    .where(
      eq(schema.oauthAccessToken.token, hashToken(token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length))),
    );
  if (!row || !row.expiresAt || row.expiresAt < new Date()) return null;
  if (row.refreshRevoked || row.clientDisabled) return null;
  // Tokens issued before every grant carried `read` are read as having it.
  const scopes = withRead(row.scopes ?? []).filter((s): s is OAuthScope =>
    (OAUTH_SCOPES as readonly string[]).includes(s),
  );
  // An install's tokens belong to its app user (client_credentials tokens have no
  // user); they work only while the application is installed. A token marked as the
  // install's but issued to anyone else is refused.
  const installation = await activeInstallation(row.clientId);
  const marked = (row.scopes ?? []).includes(APP_ACTOR_SCOPE);
  if (marked || (installation && row.userId === installation.appUserId)) {
    if (!installation) return null;
    if (row.userId && row.userId !== installation.appUserId) return null;
    return { userId: installation.appUserId, clientId: row.clientId, scopes, actor: 'app' };
  }
  if (!row.userId || (await isAppUser(row.userId))) return null;
  return { userId: row.userId, clientId: row.clientId, scopes, actor: 'user' };
}

// Deletes one access token (Linear's revoke: the token is its own credential).
export async function revokeOAuthAccessToken(token: string): Promise<boolean> {
  if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) return false;
  const deleted = await db
    .delete(schema.oauthAccessToken)
    .where(
      eq(schema.oauthAccessToken.token, hashToken(token.slice(OAUTH_ACCESS_TOKEN_PREFIX.length))),
    )
    .returning({ id: schema.oauthAccessToken.id });
  return deleted.length > 0;
}

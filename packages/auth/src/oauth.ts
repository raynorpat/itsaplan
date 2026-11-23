import { createHash } from 'node:crypto';
import { db } from '@repo/db';
import * as schema from '@repo/db/schema';
import { eq } from 'drizzle-orm';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { jwt } from 'better-auth/plugins';
import { oauthProvider } from '@better-auth/oauth-provider';

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

// Where the browser goes for each step that needs a person: the web's sign-in page
// (which resumes the authorization afterwards) and its consent page.
export function oauthPages(appUrl: string) {
  return { loginPage: `${appUrl}/login`, consentPage: `${appUrl}/oauth/consent` };
}

const isAdminRole = (role: unknown) => role === 'owner' || role === 'admin';

export const oauthPlugins = (appUrl: string) => [
  // The provider signs nothing with it for us (access tokens stay opaque, see the
  // `resource` handling in oauthBeforeHook), but it needs the JWT plugin to store
  // client secrets hashed.
  jwt({ disableSettingJwtHeader: true }),
  oauthProvider({
    ...oauthPages(appUrl),
    scopes: [...OAUTH_SCOPES, OFFLINE],
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
// ambient credential.
const COOKIE_WRITES = new Set([
  '/oauth2/consent',
  '/oauth2/continue',
  '/oauth2/create-client',
  '/oauth2/update-client',
  '/oauth2/client/rotate-secret',
  '/oauth2/delete-client',
  '/oauth2/update-consent',
  '/oauth2/delete-consent',
]);

type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// Adapts requests for the plugin. Runs in better-auth's `hooks.before`.
export async function oauthBeforeHook(ctx: HookContext, trustedOrigins: string[]): Promise<void> {
  if (COOKIE_WRITES.has(ctx.path) && ctx.headers?.get('cookie')) {
    const origin = ctx.headers.get('origin');
    if (!origin || !trustedOrigins.includes(origin))
      throw new APIError('FORBIDDEN', { message: 'This request must come from the app' });
  }

  if (ctx.path === '/oauth2/authorize') {
    const query = (ctx.query ?? {}) as Record<string, unknown>;
    // Linear's default scope is `read`; the plugin's would be every scope.
    const scopes = normaliseScopes(typeof query.scope === 'string' ? query.scope : 'read');
    // A refresh token is issued with `offline_access`, which the plugin also takes as
    // a demand for PKCE. Add it when the client uses PKCE, so a confidential client
    // that does not gets a day-long access token and no refresh token.
    if (typeof query.code_challenge === 'string' && !scopes.includes(OFFLINE)) scopes.push(OFFLINE);
    query.scope = scopes.join(' ');
    return;
  }

  if (ctx.path === '/oauth2/token') {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // With `resource` the plugin issues a JWT access token, which cannot be revoked
    // before it expires. Every token here is opaque, so it is dropped.
    delete body.resource;
    if (typeof body.scope === 'string') body.scope = normaliseScopes(body.scope).join(' ');
    return;
  }

  if (ctx.path === '/oauth2/register') {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    // A self-registered client sets nothing the admins' applications use.
    delete body.metadata;
    if (typeof body.scope === 'string') {
      const scopes = normaliseScopes(body.scope);
      if (!scopes.includes(OFFLINE)) scopes.push(OFFLINE);
      body.scope = scopes.join(' ');
    }
  }
}

// Linear's OAuth applications may use PKCE but do not have to. A confidential
// application (it has a client secret) created by an admin therefore does not require
// it; a public client always does (the plugin enforces that from the client type).
// The plugin's create-client endpoint takes no `require_pkce`, so it is set on the
// stored client after creation. Runs in better-auth's `hooks.after`.
export async function oauthAfterHook(ctx: HookContext): Promise<void> {
  if (ctx.path !== '/oauth2/create-client') return;
  const returned = ctx.context.returned as unknown;
  const created =
    returned instanceof Response
      ? ((await returned
          .clone()
          .json()
          .catch(() => null)) as Record<string, unknown> | null)
      : (returned as Record<string, unknown> | null);
  if (!created || typeof created.client_id !== 'string' || !created.client_secret) return;
  await db
    .update(schema.oauthClient)
    .set({ requirePKCE: false })
    .where(eq(schema.oauthClient.clientId, created.client_id));
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export interface OAuthGrant {
  userId: string;
  clientId: string;
  scopes: OAuthScope[];
}

// The grant behind an OAuth access token, or null when the token is unknown, expired,
// revoked (directly, or by refreshing or revoking its refresh token), or its
// application is disabled. The plugin stores a SHA-256 (base64url) hash of the token
// without its prefix.
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
  if (!row?.userId || !row.expiresAt || row.expiresAt < new Date()) return null;
  if (row.refreshRevoked || row.clientDisabled) return null;
  const scopes = (row.scopes ?? []).filter((s): s is OAuthScope =>
    (OAUTH_SCOPES as readonly string[]).includes(s),
  );
  return { userId: row.userId, clientId: row.clientId, scopes };
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

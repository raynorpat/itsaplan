import { createHash } from 'node:crypto';
import { db } from '@repo/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { passkey } from '@better-auth/passkey';
import { apiKey, defaultKeyHasher } from '@better-auth/api-key';
import { openAPI, magicLink } from 'better-auth/plugins';
import * as schema from '@repo/db/schema';
import {
  getGoogleConfig,
  isGoogleUsable,
  isAuthServiceAllowed,
  hasConfiguredEmailProvider,
  emailConfigWarnings,
  mayJoin,
  pendingInviteFor,
} from './instance';
import { sendAuthEmail } from './mail';
import { instancePlugin } from './instance-plugin';
import { OAUTH_DISABLED_PATHS, oauthAfterHook, oauthBeforeHook, oauthPlugins } from './oauth';
import { APP_ROLE, isAppUser } from './oauth-install';

// Frontend origins allowed to call the auth handler. Mandatory config: cookies, the
// WebAuthn relying party and the cookie domain are all derived from it, so a deploy
// that misses it has to fail at startup instead of running on a localhost default.
export const trustedOrigins = (process.env.APP_URL ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (trustedOrigins.length === 0) {
  throw new Error('APP_URL is not set: public origin(s) of the web app.');
}

// Parent domain for a cross-subdomain session cookie (".example.com" from
// "app.example.com"). Returns undefined for localhost, IPs, or apex domains, where
// no cross-subdomain sharing is needed. Used so the SSR web app on one subdomain can
// read the session cookie set by the api on a sibling subdomain.
function parentDomain(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return undefined;
  }
  if (host === 'localhost' || /^[\d.]+$/.test(host)) return undefined;
  const labels = host.split('.');
  if (labels.length < 3) return undefined;
  return '.' + labels.slice(1).join('.');
}

// Explicit COOKIE_DOMAIN wins (needed for multi-label TLDs or deep subdomains);
// otherwise derive it from the frontend origin.
const cookieDomain = process.env.COOKIE_DOMAIN || parentDomain(trustedOrigins[0]);

// WebAuthn relying-party id: the frontend domain the passkey is bound to (no port,
// no scheme). The WebAuthn ceremony runs in the frontend JS, so the expected origin
// is the frontend origin(s) — the same trustedOrigins list. On localhost this all
// works over http (localhost is a secure context). In prod set PASSKEY_RP_ID to the
// public frontend hostname.
const passkeyRpID = process.env.PASSKEY_RP_ID ?? new URL(trustedOrigins[0]).hostname;

// Backend origin where the better-auth handler is mounted (/api/auth/*). Mandatory:
// every link in an authentication email and the Google redirect URI are built from it.
const baseURL = process.env.API_URL;
if (!baseURL) {
  throw new Error('API_URL is not set: public origin of the backend.');
}

// Linear's workspace roles. The very first registered user becomes the workspace
// owner; everyone after joins as a member. The role is assigned server-side
// (input: false) so a client cannot request it at sign-up.
export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

// Google OAuth credentials come from GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. The
// provider is built once at startup, but it keeps this options object by reference
// and reads clientId / clientSecret off it on every call, so it is refreshed per
// request (tests change the environment between cases).
const googleOptions = { clientId: '', clientSecret: '' };

// The exact value that has to be registered as an authorized redirect URI in the
// Google Cloud console. better-auth derives it from baseURL.
export const GOOGLE_REDIRECT_URI = `${baseURL}/api/auth/callback/google`;

// Loads the credentials from the environment into that object and reports whether
// Google sign-in can run.
function refreshGoogleOptions(): boolean {
  const config = getGoogleConfig();
  googleOptions.clientId = config.clientId;
  googleOptions.clientSecret = config.clientSecret;
  return isGoogleUsable(config);
}

// Whether an address belongs to a workspace owner. An owner may always sign in with a
// magic link, whatever the allowed sign-in services, so a wrong setting cannot lock
// everyone out.
async function isOwnerAddress(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  return (
    (await db.$count(
      schema.user,
      sql`${schema.user.email} = ${address} AND ${schema.user.workspaceRole} = 'owner'`,
    )) > 0
  );
}

// Why a magic link's token would be refused when used, or null: the address has no
// account and may no longer join (NOT_INVITED), or its account is suspended
// (ACCOUNT_SUSPENDED). Tokens are stored as the plugin's hash (SHA-256, base64url).
async function magicLinkRefusal(
  adapter: {
    findVerificationValue: (identifier: string) => Promise<{ value: string } | null>;
  },
  token: string | undefined,
): Promise<'NOT_INVITED' | 'ACCOUNT_SUSPENDED' | null> {
  if (!token) return null;
  const identifier = createHash('sha256').update(token).digest('base64url');
  const stored = await adapter.findVerificationValue(identifier);
  if (!stored) return null;
  const { email } = JSON.parse(stored.value) as { email: string };
  const [existing] = await db
    .select({ id: schema.user.id, suspendedAt: schema.user.suspendedAt })
    .from(schema.user)
    .where(eq(schema.user.email, email.toLowerCase()));
  if (!existing) return (await mayJoin(email)) ? null : 'NOT_INVITED';
  return existing.suspendedAt ? 'ACCOUNT_SUSPENDED' : null;
}

// A plain shape check for an email address: one @, no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Whether an account exists for an address.
async function hasAccount(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (!address) return false;
  return (await db.$count(schema.user, eq(schema.user.email, address))) > 0;
}

// Demotes `userId` to member when another, older owner exists. Serialised with an
// advisory lock so concurrent first sign-ups settle on one owner.
async function keepFirstOwner(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('workspace_owner'))`);
    const [older] = await tx
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(
        sql`${schema.user.workspaceRole} = 'owner' AND ${schema.user.id} <> ${userId} AND (${schema.user.createdAt}, ${schema.user.id}) < (SELECT created_at, id FROM "user" WHERE id = ${userId})`,
      )
      .limit(1);
    if (older)
      await tx
        .update(schema.user)
        .set({ workspaceRole: 'member' })
        .where(eq(schema.user.id, userId));
  });
}

// Whether an API key belongs to a suspended user. Keys are stored hashed, the way
// the api-key plugin hashes them.
async function isKeyOfSuspendedUser(key: string): Promise<boolean> {
  const [row] = await db
    .select({ suspendedAt: schema.user.suspendedAt })
    .from(schema.apikey)
    .innerJoin(schema.user, eq(sql`${schema.user.id}::text`, schema.apikey.referenceId))
    .where(eq(schema.apikey.key, await defaultKeyHasher(key)));
  return !!row?.suspendedAt;
}

async function isSuspended(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ suspendedAt: schema.user.suspendedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return !!row?.suspendedAt;
}

// Whether an address is an application's app user (oauth-install.ts), which never
// signs in.
async function isAppUserAddress(email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  return (
    (await db.$count(
      schema.user,
      sql`${schema.user.email} = ${address} AND ${schema.user.workspaceRole} = ${APP_ROLE}`,
    )) > 0
  );
}

// Report mail misconfiguration once, at startup.
for (const warning of emailConfigWarnings(process.env)) console.warn(warning);

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      passkey: schema.passkey,
      apikey: schema.apikey,
      jwks: schema.jwks,
      oauthClient: schema.oauthClient,
      oauthAccessToken: schema.oauthAccessToken,
      oauthRefreshToken: schema.oauthRefreshToken,
      oauthConsent: schema.oauthConsent,
    },
  }),

  // No passwords (Linear has none): an email account is created and signed in to
  // with a magic link, or through Google or a passkey.
  emailAndPassword: { enabled: false },

  // Google sign-in. The provider is always mounted; whether it may run is decided per
  // request in the hook below, the same way the magic link is handled. The factory
  // runs once, at startup, and returns the shared options object described above.
  //
  // Account linking is left at better-auth's defaults: a Google address that already
  // has an account signs into it and gains a linked google account row, but only when
  // that account's email is confirmed (accountLinking.requireLocalEmailVerified
  // defaults to true). A Google sign-up whose address Google has not verified is
  // refused by the user-create hook below.
  socialProviders: {
    google: async () => {
      refreshGoogleOptions();
      return googleOptions;
    },
  },

  // Extra column on the user table. Not client-settable (input: false) — the
  // workspace role is decided by the create hook below.
  user: {
    additionalFields: {
      workspaceRole: {
        type: 'string',
        required: true,
        defaultValue: 'member',
        input: false,
      },
      // Set while the user is suspended (Linear's `active` = not suspended): no
      // sign-in, no session, no API key access.
      suspendedAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // OAuth requests: the Origin check on cookie writes and Linear's scopes
      // (src/oauth.ts).
      await oauthBeforeHook(ctx, trustedOrigins);

      // A magic link for an address with no account is sent only when the address
      // may join (./instance.ts mayJoin). Otherwise nothing is stored or sent, and the
      // request answers exactly as a sent one does, so it reveals nothing.
      // The same silent answer when the workspace does not allow email sign-in,
      // except for an owner.
      if (ctx.path === '/sign-in/magic-link') {
        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()))
          throw new APIError('BAD_REQUEST', { message: 'A valid email address is required' });
        if (!(await isAuthServiceAllowed('email')) && !(await isOwnerAddress(email)))
          return ctx.json({ status: true });
        if (!(await hasAccount(email)) && !(await mayJoin(email)))
          return ctx.json({ status: true });
        // An application's app user never signs in.
        if (await isAppUserAddress(email)) return ctx.json({ status: true });
        return;
      }

      // A magic link whose address may no longer join (its invite was revoked or has
      // expired) or whose account is suspended would fail inside better-auth's verify
      // endpoint, which does not catch the refusal. Check it first and send the reader
      // to the web's error page with the refusal's code, as the plugin does for an
      // invalid token; an API client without a callback URL gets the error itself.
      if (ctx.path === '/magic-link/verify') {
        const query = (ctx.query ?? {}) as {
          token?: string;
          callbackURL?: string;
          errorCallbackURL?: string;
        };
        const refusal = await magicLinkRefusal(ctx.context.internalAdapter, query.token);
        if (!refusal) return;
        const target = query.errorCallbackURL ?? query.callbackURL;
        if (!target) throw new APIError('FORBIDDEN', { code: refusal, message: refusal });
        const url = new URL(decodeURIComponent(target), ctx.context.baseURL);
        url.searchParams.set('error', refusal);
        throw ctx.redirect(url.toString());
      }

      // Passkey sign-in, when the workspace does not allow passkeys.
      if (
        ctx.path.startsWith('/passkey/generate-authenticate-options') ||
        ctx.path.startsWith('/passkey/verify-authentication')
      ) {
        if (!(await isAuthServiceAllowed('passkey'))) {
          throw new APIError('FORBIDDEN', {
            message: 'Passkey sign-in is not allowed in this workspace',
          });
        }
        return;
      }

      // Every Google step: starting a sign-in, coming back from Google (the callback
      // route is declared as /callback/:id, so the provider is in the params), and
      // linking Google to a signed-in account. This is where the credentials are
      // loaded into the provider's options. Google needs both credentials set and the
      // workspace to allow it.
      const googleCallback =
        ctx.path === '/callback/:id' &&
        (ctx.params as { id?: string } | undefined)?.id === 'google';
      if (ctx.path === '/sign-in/social' || ctx.path === '/link-social' || googleCallback) {
        if (!refreshGoogleOptions() || !(await isAuthServiceAllowed('google'))) {
          throw new APIError('FORBIDDEN', {
            message: 'Google sign-in is not available in this workspace',
          });
        }
      }
    }),
    // OAuth applications created by an admin (src/oauth.ts).
    after: createAuthMiddleware(async (ctx) => oauthAfterHook(ctx)),
  },

  databaseHooks: {
    // A suspended user gets no new session, whichever sign-in method they use, and
    // neither does an application's app user (oauth-install.ts).
    session: {
      create: {
        before: async (session) => {
          if (await isAppUser(session.userId)) {
            throw new APIError('FORBIDDEN', {
              code: 'APP_USER',
              message: 'An application cannot sign in',
            });
          }
          if (await isSuspended(session.userId)) {
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_SUSPENDED',
              message: 'This account is suspended',
            });
          }
        },
      },
    },
    user: {
      create: {
        // Every account creation passes here: a used magic link or a Google sign-up,
        // both with a proven address. The address must be allowed to join
        // (./instance.ts mayJoin): the first user becomes the owner, an invited
        // address takes the invite's role, an approved domain joins as a member.
        before: async (user) => {
          // Only a verified address may claim an invite or an approved domain. A used
          // magic link always verifies it; Google reports its own email_verified claim.
          if (user.emailVerified !== true) {
            throw new APIError('FORBIDDEN', {
              code: 'EMAIL_NOT_VERIFIED',
              message: 'The address must be verified to join the workspace',
            });
          }
          const join = await mayJoin(user.email);
          if (!join) {
            throw new APIError('FORBIDDEN', {
              code: 'NOT_INVITED',
              message: 'This address has not been invited to the workspace',
            });
          }
          return { data: { ...user, workspaceRole: join.role } };
        },
        // Linear accepts an invite at sign-up: the new account joins the invite's
        // teams that still exist, and the invite is consumed.
        after: async (user) => {
          // Two first sign-ups at once both count zero users in `before`. Keep only
          // the oldest owner made that way: a later one becomes a member.
          if ((user as { workspaceRole?: string }).workspaceRole === 'owner')
            await keepFirstOwner(user.id);
          const invite = await pendingInviteFor(user.email);
          if (!invite) return;
          if (invite.teamIds.length) {
            const teams = await db
              .select({ id: schema.team.id })
              .from(schema.team)
              .where(inArray(schema.team.id, invite.teamIds));
            if (teams.length)
              await db
                .insert(schema.teamMember)
                .values(teams.map((t) => ({ teamId: t.id, userId: user.id })))
                .onConflictDoNothing();
          }
          await db.delete(schema.workspaceInvite).where(eq(schema.workspaceInvite.id, invite.id));
        },
      },
    },
  },

  plugins: [
    // Instance information and the team owner change (src/instance-plugin.ts).
    instancePlugin({ trustedOrigins }),
    // WebAuthn passkeys, a sign-in method alongside the magic link and Google. A
    // passkey is added to an already signed-in account (passkey.addPasskey) and
    // then used to sign in (signIn.passkey). Adds the `passkey` table.
    passkey({
      rpID: passkeyRpID,
      rpName: process.env.PASSKEY_RP_NAME ?? "It's a Plan",
      // Expected origin(s) of the WebAuthn ceremony — the frontend origins.
      origin: trustedOrigins,
    }),
    // Personal API keys: a signed-in user creates a named key, sees its value once
    // at creation, and can list (value hidden) or delete it. Adds the `apikey` table.
    // enableSessionForAPIKeys makes a request carrying an `x-api-key` header resolve
    // to the key owner's session, so getSession accepts API keys. Rate limit: 100 requests per
    // second per key (timeWindow is in milliseconds). The ceiling is set for the
    // heaviest legitimate caller rather than a typical one: an internal AI agent runs
    // on its own key and dispatches every tool call through a route, and a model that
    // emits a batch of tool calls in one step turns them into a burst of requests.
    apiKey({
      enableSessionForAPIKeys: true,
      // A suspended user's key is refused on every endpoint, better-auth's own
      // included (getActiveSession covers the API's).
      customAPIKeyValidator: async ({ key }) => !(await isKeyOfSuspendedUser(key)),
      // Brand prefix so a leaked key is identifiable by secret scanners and in logs.
      // The trailing underscore separates it from the random part (itp_<64 chars>).
      defaultPrefix: 'itp_',
      rateLimit: {
        enabled: true,
        timeWindow: 1000,
        maxRequests: 100,
      },
    }),
    // Sign-in and sign-up by emailed link: the email route of the instance. With no
    // mail provider configured, or when sending fails, the link is written to the API
    // log instead, so an operator can always sign in. The send is not awaited: a
    // request answers in the same time whether or not a link goes out, so its timing
    // does not reveal whether an address has an account or may join. It reuses the
    // `verification` table.
    magicLink({
      // Only a hash of each token is stored, so reading the verification table does
      // not give working links.
      storeToken: 'hashed',
      sendMagicLink: async ({ email, url }) => {
        const logLink = () => console.info(`[auth] magic link for ${email}: ${url}`);
        if (!(await hasConfiguredEmailProvider())) {
          logLink();
          return;
        }
        void sendAuthEmail({
          to: email,
          subject: 'Your sign-in link',
          text: 'Use the link below to sign in. It works once and expires shortly.',
          url,
        }).then(
          (sent) => {
            if (!sent) logLink();
          },
          () => logLink(),
        );
      },
    }),
    // The OAuth server (src/oauth.ts): Linear's OAuth applications and MCP clients.
    // Adds the oauthClient, oauthAccessToken, oauthRefreshToken, oauthConsent and jwks
    // tables.
    ...oauthPlugins(trustedOrigins[0]!, baseURL),
    // OpenAPI reference for the better-auth handler. Serves a Scalar UI at
    // /api/auth/reference and the raw schema at /api/auth/open-api/generate-schema.
    // The schema is built from every active plugin, so the passkey and apiKey
    // endpoints are documented automatically. This is docs-only: it adds no table,
    // so `auth:generate` is not needed.
    openAPI(),
  ],

  // The frontend runs on a different origin (Next :3001) — allow its requests.
  trustedOrigins,

  // The JWT plugin's session token endpoint: nothing here accepts a JWT, so it is
  // not offered. userinfo and end-session are OpenID Connect, which is not enabled.
  // The OAuth plugin's client and consent management is replaced by the instance
  // plugin's (OAUTH_DISABLED_PATHS).
  // The plugin's own discovery documents are replaced by the API's
  // (/.well-known/oauth-authorization-server at the API root), which name Linear's
  // paths; both state the same issuer (oauthIssuer).
  disabledPaths: [
    '/token',
    '/oauth2/userinfo',
    '/oauth2/end-session',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
    ...OAUTH_DISABLED_PATHS,
  ],

  advanced: {
    // Every id is a UUID, as in Linear's API. The columns are uuid in
    // packages/db/src/schema/auth.ts.
    database: { generateId: 'uuid' },
    // Share the session cookie across subdomains when COOKIE_DOMAIN is the parent
    // domain (e.g. ".itsaplan.dev" for app.itsaplan.dev + api.itsaplan.dev). Without
    // it the cookie is host-only for the api origin, so the SSR web app on another
    // subdomain cannot read the session. Leave COOKIE_DOMAIN unset on localhost
    // (single host), where "lax" host-only cookies already work across ports.
    ...(cookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: cookieDomain,
          },
        }
      : {}),
    // For a single site (localhost / one domain) "lax" is enough. Subdomains of one
    // registrable domain are same-site, so "lax" cookies are still sent between them.
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  },
});

// Thrown by auth.api calls; re-exported so the api can tell an auth failure (an
// unknown API key) from other errors without depending on better-auth directly.
export { APIError };

export type Auth = typeof auth;

// The session for a request, or null when there is none or its user is suspended.
// Every API entry point (GraphQL, MCP, the instance plugin) resolves sessions through this, so an
// API key of a suspended user is refused too.
export async function getActiveSession(headers: Headers) {
  // The api-key plugin rejects a refused key (a suspended user's) with an error
  // rather than returning no session; both mean no session here.
  const session = await auth.api.getSession({ headers }).catch((err: unknown) => {
    if (err instanceof APIError) return null;
    throw err;
  });
  if (!session) return null;
  if (await isSuspended(session.user.id)) return null;
  return session;
}
export type Session = Auth['$Infer']['Session'];

// Instance authentication configuration (mail provider from the environment, Google
// credentials, who may join). Read here by the sign-up rules and the mail senders.
export {
  getEmailSettings,
  getEmailConfig,
  getNotificationEmailConfig,
  hasConfiguredEmailProvider,
  getGoogleConfig,
  hasConfiguredGoogle,
  allowedAuthServices,
  isAuthServiceAllowed,
  approvedDomains,
  mayJoin,
  emailConfigWarnings,
  signInOptions,
} from './instance';
export { provideInstanceHandlers } from './instance-plugin';
export type { InstanceHandlers, TeamOwnerChange } from './instance-plugin';
export type { InstanceEmailDto, InstanceEmailConfig, InstanceGoogleConfig } from './instance';
export {
  OAUTH_SCOPES,
  OAUTH_ACCESS_TOKEN_PREFIX,
  MCP_CLIENT_SCOPES,
  clientMetadata,
  isWorkspaceApplication,
  newClientSecret,
  normaliseScopes,
  oauthIssuer,
  resolveOAuthAccessToken,
  revokeOAuthAccessToken,
} from './oauth';
export type { OAuthScope, OAuthGrant } from './oauth';
export { APP_ACTOR_SCOPE, APP_ROLE, uninstallApplication } from './oauth-install';
export type { OAuthAppsHandlers, WorkflowsHandlers } from './instance-plugin';

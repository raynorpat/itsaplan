# @repo/auth

The **server-side** better-auth instance. Consumed by `apps/api`. See root `AGENTS.md`.

- `src/index.ts` — `export const auth = betterAuth({...})` with the Drizzle adapter
  (`provider: "pg"`) over `@repo/db`. No passwords (`emailAndPassword` off, as in
  Linear): people sign in with a magic link, Google, or a WebAuthn passkey
  (`@better-auth/passkey`).
- Exports `auth`, `getActiveSession`, `WORKSPACE_ROLES` / `WorkspaceRole`, plus `Auth` / `Session` types.

## Instance endpoints (`src/instance-plugin.ts`)

A better-auth plugin serves what Linear's GraphQL schema has no place for, under
`/api/auth/instance/*`: `GET sign-in-options` (public, `signInOptions()` in
`src/instance.ts`, also behind REST `/auth-config`), `GET version` and
`GET upload-limits` (signed in), and `POST team-owner` `{ teamId, userId, owner }`
(team managers; Linear's schema exposes `TeamMembership.owner` but no input that sets
it). The last three need the API's session and access rules, which this package cannot
import, so `apps/api` registers them at startup with `provideInstanceHandlers`
(`apps/api/src/instance/handlers.ts`). A handler refuses by throwing an error with an
HTTP `status`, which the plugin turns into better-auth's error of that status. A
`POST team-owner` that carries the session cookie must send an `Origin` from
`trustedOrigins` (CSRF); better-auth does not check the origin on plugin endpoints.

## OAuth server (`src/oauth.ts`)

`@better-auth/oauth-provider` (pinned to the better-auth version) is the OAuth server,
with the JWT plugin it needs to store client secrets hashed (its `/token` endpoint is
in `disabledPaths`; nothing accepts a JWT). The API serves Linear's paths
(`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, `/oauth/register`,
`/.well-known/oauth-authorization-server`) and forwards them to `/api/auth/oauth2/*`
(`apps/api/src/oauth/routes.ts`).

- Scopes are Linear's (`OAUTH_SCOPES`). `oauthBeforeHook` accepts them comma-separated,
  defaults a missing scope to `read`, and adds the plugin's `offline_access` when the
  request uses PKCE, which is what gets the plugin to issue a refresh token. A
  confidential application that skips PKCE (the plugin would demand PKCE with
  `offline_access`) gets its refresh token from `oauthAfterHook`, in the plugin's format,
  so every application has one, as in Linear. The token response lists Linear's
  scopes only. It drops `resource` at the token endpoint, so every access token is
  opaque and can be revoked.
- Access tokens start `itpo_` (refresh `itpr_`, client secrets `itpcs_`); all are
  stored hashed. `resolveOAuthAccessToken` is how the API checks one: unknown,
  expired, deleted, issued from a revoked refresh token, or of a disabled
  application → null. A refresh revokes the previous refresh token and, through
  that, its access tokens.
- Applications are created and managed by workspace admins and owners through the
  instance plugin (`/instance/oauth-apps*`, below). The plugin's own client and
  consent endpoints are disabled (`OAUTH_DISABLED_PATHS`): they let only a client's
  creator change it. An admin-created application is marked `application: true` in
  its metadata (`isWorkspaceApplication`; the plugin stores metadata as a JSON string
  in the jsonb column, read with `clientMetadata`); a confidential one does not
  require PKCE, as Linear's do. Dynamic registration (MCP clients) needs no session,
  always gives a public client (PKCE required), and only `read`, `write`,
  `issues:create` and `comments:create` (`MCP_CLIENT_SCOPES`; default `read write`).
  An authorize request without a scope gets `read` for an application and the
  registered scopes for a self-registered client.
- Cookie-authenticated writes to the consent endpoints must send an `Origin` from
  `trustedOrigins`, as the instance plugin's do.
- The consent page is the web's `/oauth/consent`, the sign-in page `/login`.

### `actor=app` installs (`src/oauth-install.ts`)

- Linear's `actor=app` (or `application`) on the authorize request adds the internal
  scope `actor:app` (`APP_ACTOR_SCOPE`, never advertised; a client sending it as a scope
  has it stripped). A self-registered client's scopes do not include it, so an MCP
  client cannot install. The plugin re-runs the authorize step internally when it
  resumes a signed request; the hook leaves those alone.
- The consent POST that grants it must come from a workspace admin or owner and may
  carry the team selection: `app_team_ids` (teams added by id, public or private) and
  `app_public_teams` (default true: every public team, including later ones). Once the
  plugin accepts the consent, `installApplication` creates the application's app user
  (`workspace_role` = `app`, an `@apps.invalid` address, the application's name and
  icon) and the `oauth_installation` row (scopes granted, `public_teams`), and makes it
  a member of the chosen teams. Installing again reuses both.
- A code of the install is exchanged only while the application is installed and its
  installer is still an admin or owner. `resolveOAuthAccessToken` maps a token with
  `actor:app` to the install's app user (`actor: 'app'`).
- `client_credentials` needs the grant on the application and an install; it gives an
  app-user token within the install's scopes.
- An app user never signs in: `databaseHooks.session.create.before` refuses it and no
  magic link is issued for its address.
- `POST /api/auth/instance/oauth-uninstall { clientId }` (admins and owners, Origin
  rule) deletes every token, refresh token, consent and pending code of the
  application, suspends its app user and removes it from its teams.

### Managing applications and authorizations

- `GET /instance/oauth-apps` and `POST /instance/oauth-apps/{create, update,
  rotate-secret, rotate-webhook-secret, archive}` (admins and owners, Origin rule) are
  handled by the API (`apps/api/src/oauth/apps.ts`, registered through
  `provideInstanceHandlers`), which validates the application's webhook. The client
  secret and the webhook secret are in the answers of create and the rotations only.
  Rotating the client secret stops the old one at once and deletes the
  `client_credentials` tokens; archiving uninstalls the application and disables it.
- `GET /instance/oauth-authorized` and `POST /instance/oauth-authorized/revoke
  { clientId }` (signed in, Origin rule; `src/oauth-authorized.ts`) list and revoke
  the applications the person authorized to act as themselves. An `actor=app`
  install's consent and tokens are the workspace's: not listed, not revoked here.
- Token rows of an `actor=app` install carry the installing admin as their user. Users
  are never deleted (suspension), so the install keeps working when its installer is
  suspended or demoted; only new install codes need the installer to be an admin.

## Workspace role and suspension

The user table has `workspace_role` (`owner` | `admin` | `member` | `guest`, Linear's
roles; `app` for an application's app user) and `suspended_at`, both better-auth `additionalFields` with `input: false`
(not client-settable). `databaseHooks.user.create.before` decides whether an address
may join and with which role (`mayJoin` in `src/instance.ts`): the first user of a
fresh instance is the owner; an address with a pending, unexpired workspace invite
gets the invite's role; an address on an `APPROVED_EMAIL_DOMAINS` domain is a member;
anything else is refused. The hook also refuses an address that is not verified
(`emailVerified`): a used magic link always verifies it, and Google reports its own
`email_verified` claim, so the address is what claims the invite. `create.after`
joins the invite's teams and deletes the invite. `databaseHooks.session.create.before` refuses a session to a
suspended user, whatever the sign-in method. `getActiveSession(headers)` wraps
`getSession` and returns null for a suspended user, so their API keys stop working;
every API entry point resolves sessions through it.

## Joining and the magic link (`src/instance.ts`)

- The magic link is the email route for sign-in and sign-up. `hooks.before` answers a
  `/sign-in/magic-link` request for an address with no account that may not join
  exactly as a sent one (`{ status: true }`) without storing or sending a link, so the
  request never reveals whether an address may join or has an account.
- The mail provider comes from environment variables (`SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` tls / starttls / none, or
  `RESEND_API_KEY`; `EMAIL_FROM`). With none configured, or when sending fails,
  `sendMagicLink` writes the link to the log (`[auth] magic link for <email>: <url>`)
  so an operator can always sign in; nothing else is emailed. The send is not
  awaited, so a request answers in the same time whether or not a link goes out.
  At startup `emailConfigWarnings` logs a provider that cannot send (Resend without
  `EMAIL_FROM`, SMTP with neither `EMAIL_FROM` nor `SMTP_USER`) and a production
  instance with no provider.
- `approvedDomains()` reads `APPROVED_EMAIL_DOMAINS` per call (comma-separated, case
  and spaces ignored).

Authentication email (`src/mail.ts`) goes out through `@repo/mailer` and is best
effort: a failed send logs and returns false rather than failing the request. Every
link must carry a `callbackURL` on the **web** origin — the handler runs on the API
origin, so a link built without one lands the reader on the API, which renders
nothing. The web app passes it in `features/auth/services`.

## Passkey

`passkey({ rpID, rpName, origin })` adds WebAuthn. `rpID` is the frontend hostname the
credential binds to — derived from the first `APP_URL` entry, overridable with
`PASSKEY_RP_ID` (set it to the public frontend hostname in prod). `origin` is the whole
`APP_URL` list (the WebAuthn ceremony runs in the frontend JS). The plugin adds
the `passkey` table, which is mapped in the drizzle adapter's `schema`. localhost is a
secure context, so passkeys work over http in dev.

## Google sign-in

The credentials come from `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; Google sign-in is
available when both are set and the workspace allows `google` (below).

`socialProviders.google` is a factory that returns the module-level `googleOptions`
object. better-auth builds the provider list once at startup, but the provider keeps that
object **by reference** and reads `clientId` / `clientSecret` off it on every call, so
`refreshGoogleOptions()` in `hooks.before` reloads it from the environment on
`/sign-in/social`, the Google callback (declared as `/callback/:id`, so the hook matches
the path pattern and the `id` param) and `/link-social`, and refuses the request when the
credentials are missing or the workspace does not allow Google. Do not replace the object
(`googleOptions = {...}`) — assign its fields, or the provider keeps reading the old one.

## Allowed sign-in services

The workspace's `organization.allowed_auth_services` (`email` = magic link, `google`,
`passkey`; empty = every configured one) is enforced in `hooks.before`: a magic-link
request answers like a sent one and sends nothing when `email` is not allowed, unless the
address is a workspace owner's (so a wrong setting cannot lock everyone out); Google and
passkey sign-in are refused with 403. `/auth-config` reports what the sign-in page may
offer.

Account linking is left at better-auth's defaults, which means
`accountLinking.requireLocalEmailVerified` is `true`: a Google address that already has an
account signs into it only when that account's email is confirmed. Every account is
created from a proven address (magic link or Google), so this holds for all of them.

The joining rules (`mayJoin`) run in `databaseHooks.user.create.before`, which every
account creation passes, and that is what applies them to a Google sign-up: an address
that may not join is refused. The `APIError` carries a `code` (`NOT_INVITED`) because
the social callback turns that into the `?error=` it redirects with; without one the
callback fails the request instead.

## OpenAPI reference

The `openAPI()` plugin (`better-auth/plugins`) documents the auth handler. It serves a
Scalar UI at `/api/auth/reference` and the raw schema at
`/api/auth/open-api/generate-schema`. The schema is built from every active plugin, so
the passkey and apiKey endpoints appear without any manual description. This is separate
from the planner's own OpenAPI docs at `/docs` (the `@elysiajs/swagger` spec, which does
not see the catch-all auth handler). Docs-only: it adds no table, so `auth:generate` is
not required for it.

## Rules

- This package is **server-only** — never import a client SDK (`better-auth/react`) here;
  the web app owns its own `auth-client.ts`.
- Changing the config (plugins, fields) can change the DB tables → run `bun run auth:generate`
  (writes `packages/db/src/schema/auth.ts`), then `db:generate` + `db:migrate`.
- Config is env-driven: `API_URL` (backend origin, used as better-auth `baseURL`),
  `BETTER_AUTH_SECRET`, `APP_URL` (frontend origin(s), comma-separated). `API_URL` and
  `APP_URL` are mandatory and have no default — importing this module throws
  when either is missing. Do not add a localhost fallback: cookies, the passkey
  relying party, the cookie domain and every link in an authentication email are
  derived from them, so a wrong value fails silently at runtime instead of at startup.
  The parsed `trustedOrigins` list (from `APP_URL`) is exported so the api's CORS uses
  the same value.
- **Cross-domain prod:** default cookies are `sameSite: "lax"`. If frontend/backend run on
  different domains, switch to `sameSite: "none"` + `secure: true`; for subdomains use
  `advanced.crossSubDomainCookies`.

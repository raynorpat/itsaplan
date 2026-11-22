# @repo/auth

The **server-side** better-auth instance. Consumed by `apps/api`. See root `AGENTS.md`.

- `src/index.ts` — `export const auth = betterAuth({...})` with the Drizzle adapter
  (`provider: "pg"`) over `@repo/db`. No passwords (`emailAndPassword` off, as in
  Linear): people sign in with a magic link, Google, or a WebAuthn passkey
  (`@better-auth/passkey`).
- Exports `auth`, `getActiveSession`, `WORKSPACE_ROLES` / `WorkspaceRole`, plus `Auth` / `Session` types.

## Workspace role and suspension

The user table has `workspace_role` (`owner` | `admin` | `member` | `guest`, Linear's
roles) and `suspended_at`, both better-auth `additionalFields` with `input: false`
(not client-settable). `databaseHooks.user.create.before` decides whether an address
may join and with which role (`mayJoin` in `src/instance.ts`): the first user of a
fresh instance is the owner; an address with a pending, unexpired workspace invite
gets the invite's role; an address on an `APPROVED_EMAIL_DOMAINS` domain is a member;
anything else is refused. Every account is created from a proven address (a used
magic link or Google), so the address is what claims the invite. `create.after`
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
  `RESEND_API_KEY`; `EMAIL_FROM`). With none configured, `sendMagicLink` writes the
  link to the log (`[auth] magic link for <email>: <url>`) so an operator can still
  sign in; nothing else is emailed.
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

The credentials live in the database (`app_secret` key `auth.google`, encrypted), not in
env, so god mode can change them without a restart. That is the only reason the provider
is wired the way it is:

`socialProviders.google` is a factory that returns the module-level `googleOptions`
object. better-auth builds the provider list once at startup, but the provider keeps that
object **by reference** and reads `clientId` / `clientSecret` off it on every call, so
`refreshGoogleOptions()` in `hooks.before` reloads it on `/sign-in/social` and
`/callback/google` and refuses the request when the credentials are missing or the toggle
is off. Do not replace the object (`googleOptions = {...}`) — assign its fields, or the
provider keeps reading the old one.

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

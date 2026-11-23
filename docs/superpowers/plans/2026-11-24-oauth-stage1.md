# Project 6 Stage 6.1 (OAuth server, OAuth applications, MCP sign-in) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrations and MCP clients sign in to this app with OAuth as they do with Linear: admins register OAuth applications, users consent, `actor=app` installs create app users, and `/graphql` and `/mcp` accept OAuth tokens with Linear's scopes.

**Architecture:** `@better-auth/oauth-provider` (1.6 line) in `packages/auth` provides the OAuth server; Linear's paths, comma scopes, `actor=app` and app users are added around it. Task 1 sets up the server and scope checks on `/graphql`; Task 2 adds `actor=app`, app users and `client_credentials`; Task 3 adds application webhooks and MCP sign-in; Task 4 builds the web pages and runs the end-to-end smoke test.

**Tech Stack:** Bun, Elysia, better-auth + `@better-auth/oauth-provider`, Drizzle, graphql-yoga with Linear's SDL; Next.js 15, React 19, TanStack Query 5; Bun tests (API) and node:test (web).

**Spec:** `docs/superpowers/specs/2026-11-24-oauth-agent-api-design.md` (stage 6.1 sections, "Who can do what", anti-goals)

## Global Constraints

- Linear's SDL is never edited. Incremental migrations (`bun run db:generate`, plus `auth:generate` for plugin tables).
- Linear's paths `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` with Linear's parameters; comma or space scopes accepted.
- Scopes: `read`, `write`, `issues:create`, `comments:create`, `admin`, `app:assignable`, `app:mentionable`. Queries need `read`; mutations need `write` except issue create (`issues:create`) and comment create (`comments:create`); admin operations need `admin` plus the user's rights. A token never exceeds its user's rights.
- Refresh tokens without `offline_access`; refresh revokes the previous tokens. Client secrets and tokens stored hashed; secrets shown once.
- PKCE required for public clients; only registered redirect URIs.
- Dynamic registration only for MCP clients: allowed scopes `read`, `write`, `issues:create`, `comments:create`; default `read,write`; no `actor=app`; not listed with admin applications.
- `actor=app` install and application management: admins and owners. App users: role `app`, cannot sign in, not counted, hidden from member lists, see only selected teams (default all public teams), never admin.
- Cookie-authenticated POSTs (consent, instance plugin) keep the stage 5.5 Origin check.
- Follow AGENTS.md files and `DESIGN.md`. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A token with only `read` calling any mutation, or `issues:create` calling `issueUpdate`, is refused with Linear's error; an MCP-registered client asking for `admin` or `actor=app` is refused. Test in Task 1.
2. An authorization code is single-use, bound to its redirect URI and PKCE verifier; a reused or mismatched one is refused. Test in Task 1.
3. A non-admin cannot install with `actor=app`, and an `actor=app` token cannot reach a team the admin did not select (private or public). Test in Task 2.
4. Uninstalling an app revokes every token (code, access, refresh, client_credentials) at once and deactivates the app user; its comments stay. Test in Task 2.
5. Rotating a client secret makes the old one fail at the token endpoint at once; secrets never appear in later reads or logs. Test in Task 1 / Task 3.

---

### Task 1: OAuth server, Linear paths, scopes on `/graphql`

**Files:** `packages/auth` (add `@better-auth/oauth-provider` at the 1.6 version matching better-auth; plugin config: scopes, consent page URL `${APP_URL}/oauth/consent`, login page, `storeClientSecret` hashed, tokens hashed, refresh without `offline_access`, dynamic registration limited as above, `client_credentials` enabled for later), Linear path aliases (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke` on the API, forwarding with scope normalisation), discovery documents at the API root, `packages/db` schema + migration, `apps/api/src/graphql` context (Bearer token resolution distinct from API keys; `ctx.scopes`), a scope check per operation (queries `read`; mutations `write` or the narrow scopes; admin operations `admin`).

**Interfaces (Produces):** `ctx.auth = { user, kind: 'session' | 'apiKey' | 'oauth', scopes?, clientId?, actor? }`; `requireScope(ctx, operation)`; `normaliseScopes(raw)`.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/__tests__/integration/oauth-flow.test.ts`, `graphql/__tests__/integration/oauth-scopes.test.ts`): full code + PKCE flow through `/oauth/authorize` (signed-in user, consent posted) → `/oauth/token` → `viewer` query with the token; comma scopes accepted; reused code, wrong verifier, unregistered redirect refused; refresh without `offline_access` works and revokes the old pair; `/oauth/revoke` revokes; `read` token mutation refused; `issues:create` allows `issueCreate` but not `issueUpdate`; `comments:create` allows `commentCreate`; `admin` without admin rights refused; dynamic registration with `admin` scope refused, default scopes `read write`; rotated secret (plugin endpoint) fails at once.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat: OAuth server with Linear's paths and scopes`

### Task 2: `actor=app`, app users, `client_credentials`

**Files:** `packages/db` (user `app` flag / `app` role, app membership marker on team membership, installation record: application, app user, selected teams, granted scopes), `packages/auth` (authorize with `actor=app`: admin-only, team selection carried through consent, token issued for the app user; `client_credentials` for installed apps → app-user token; uninstall endpoint revoking all tokens and deactivating the app user), `apps/api/src/shared/access.ts` (role `app`: selected teams only; never admin), user listing / member lists / counts exclude app users; GraphQL `User.app`, assignee / mention candidates include app users only with `app:assignable` / `app:mentionable`.

- [ ] **Step 1: Write the failing tests** (`oauth-app-actor.test.ts`): non-admin `actor=app` refused; admin install creates one app user per application (re-install reuses it); token acts as the app user (`viewer.app === true`); app user cannot reach an unselected team (public or private) and has no admin rights; app user absent from `users` member counts and team member lists, present in `users` with `app: true` where Linear lists it; `client_credentials` returns an app-user token for an installed app and is refused before install; uninstall revokes access, refresh and client_credentials tokens and deactivates the app user; its comment still resolves its author.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat: OAuth app installs with app users`

### Task 3: Application management endpoints, application webhooks, MCP sign-in

**Files:** instance plugin / OAuth plugin endpoints for admins (create / edit / rotate secret / rotate webhook secret / archive applications, list installed apps, uninstall) and users (authorized apps, revoke), webhook table owner for application webhooks + worker delivery with the app's secret for the app user's teams (or public teams for `actor=user`-only apps), `/mcp` accepting OAuth tokens (protected-resource metadata, `WWW-Authenticate` on 401, dispatch carrying user + scopes, tool scope rule from the spec).

- [ ] **Step 1: Write the failing tests** (`oauth-apps-admin.test.ts`, `oauth-app-webhooks.test.ts`, `mcp-oauth.test.ts`): member cannot create / edit / archive apps; secret shown on create and rotate only; archived app's tokens refused; user lists and revokes own authorizations; app webhook fires for the app user's teams only, signed with the app's secret; `/mcp` 401 carries `WWW-Authenticate` with the resource metadata URL; MCP client registers, authorizes, calls a read tool with `read`, is refused a write tool without `write`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat: OAuth application management, app webhooks and MCP sign-in`

### Task 4: Web — consent page, OAuth applications, authorized apps

**Files:** `app/oauth/consent` (app name, icon, developer, scopes in plain words, `actor=app` notice with team selection for admins, workspace, Allow / Deny), Settings → API → OAuth applications (admins; create with secret shown once, edit, rotate secrets, archive, installed apps with uninstall), account → Authorized apps (revoke), app users shown with an app badge in pickers and on comments / history, delegate / assignee / mention pickers respecting `app:assignable` / `app:mentionable`.

- [ ] **Step 1: Write the failing tests** for pure helpers (scope → plain-words list; consent form → plugin input incl. team selection; app badge selection).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build`, full API suite; HTTP smoke test against the test DB (API 3100, web 3101; port 3000 taken; magic link from the API log): admin creates an app; code + PKCE flow through the consent page (Allow) → token → GraphQL `viewer` and an `issueCreate` with `issues:create`; refresh; revoke; `actor=app` install with one selected team → app-user token → refused on another team; `client_credentials`; MCP discovery → register → authorize → tool call; uninstall; pages `/oauth/consent?...`, settings OAuth applications, account authorized apps render — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): OAuth consent, applications and authorized apps`

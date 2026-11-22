# Organization Settings and Passwordless Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace god mode with Linear's `Organization` settings and environment variables, and replace passwords with magic links, Google and passkeys.

**Architecture:** better-auth loses `emailAndPassword`; magic link becomes the email route and its sign-up rules (invite, approved domain, first user) run in the user-create hook. A single-row `organization` table backs `Organization` / `organizationUpdate` and the web's workspace settings page; secrets and limits come from environment variables; the god feature is deleted.

**Tech Stack:** Bun, Elysia, better-auth (magic link, Google, passkey, API keys), Drizzle/Postgres, graphql-yoga with Linear's SDL, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-22-organization-settings-design.md`

## Global Constraints

- No passwords: `emailAndPassword` off, `credential` account rows deleted in the migration.
- A new email account exists only after its magic link is used; a link for an address that may not join is not sent, and the request answers exactly like any other.
- May join: pending invite for the proven address (takes its role and teams), an `APPROVED_EMAIL_DOMAINS` domain (member), or the first user of a fresh instance (owner). Google sign-up follows the same rules with Google's verified address.
- No email provider: the magic link is written to the API log (prefixed so it is easy to find) instead of sent.
- `allowedAuthServices`: `email` (magic link), `google`, `passkey`; empty = all configured; an owner can always use a magic link.
- Minimum roles for team creation, label management, invites (`owner` | `admin` | `member`, default `member`) via `securitySettings.teamCreationRole` / `labelManagementRole` / `invitationsRole`; `user` = member; `guest` / `app` INVALID_INPUT; deprecated booleans derived.
- Env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` (`tls`/`starttls`/`none`), `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPROVED_EMAIL_DOMAINS`, `MAX_ATTACHMENT_MB` (25), `MAX_AVATAR_MB` (5), `TEAM_QUOTA_MB` (51200, 0 = unlimited); in `.env.example` and both deploy compose files.
- Organization settings: owners and admins only. `organizationDomainDelete` stays NOT_IMPLEMENTED.
- Incremental migrations. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A magic-link request for an address that may not join sends nothing, creates nothing, and answers like a request for an existing address. Test in Task 1.
2. With `allowedAuthServices = ['google']`, an owner can still sign in with a magic link; a member cannot. Test in Task 2.
3. A member's `organizationUpdate` → FORBIDDEN; a guest cannot read `organization.users` beyond their teams' people. Test in Task 2.
4. With `teamCreationRole = admin`, a member's team create is refused over REST and GraphQL. Test in Task 2.
5. The password sign-in endpoint no longer signs anyone in. Test in Task 1.

---

### Task 1: Passwordless sign-in and joining rules

**Files:** `packages/auth/src/index.ts` (drop `emailAndPassword`; magic link as the email route with the may-join check; user-create hook: invite by proven email, approved domain, first user; Google sign-up the same; log fallback when no provider), `packages/auth/src/instance.ts` (drop registration / verification / magic-link settings, invite-token check), `packages/mailer` (env-based provider), `apps/api/src/__tests__/helpers/auth.ts` (`signUpTestUser` without a password: create via magic link and consume the captured link, or create user + session directly through better-auth's internal adapter — keep its return shape `{ cookie, userId, email }` and its `inviteToken`-free options), migration deleting `credential` accounts, `apps/api/src/invites` (drop token-at-sign-up logic).

**Interfaces (Produces):** `mayJoin(email: string): Promise<{ role: WorkspaceRole; teamIds: string[]; inviteId?: string } | null>`; `approvedDomains(): string[]` (from env); `sendMagicLink` logging fallback.

- [ ] **Step 1: Write the failing tests** `packages/auth`-level via the API app in `apps/api/src/__tests__/integration/sign-in.test.ts`:
  - `creates an invited account from its magic link` — admin invites `g@x.test` as guest to OPS; request a magic link for it, use the link → account with role guest, OPS membership, invite consumed.
  - `joins an approved domain as a member` — `APPROVED_EMAIL_DOMAINS=corp.test` (set in the test's env for this case); link for `a@corp.test` → member.
  - `sends nothing for an address that may not join` — link request for `z@nowhere.test` answers 200 like the others, no email/log line, no user created.
  - `refuses password sign-in` — `POST /api/auth/sign-in/email` and `/sign-up/email` → not 200 and no session.
  - `logs the link when no email provider is configured` — capture the log; it contains the link.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; switch `signUpTestUser` to the passwordless route and run the full API suite until green.
- [ ] **Step 4: Run** full API suite and root checks — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat(auth)!: sign in with magic links, Google or passkeys instead of passwords`

### Task 2: Organization settings and environment configuration

**Files:** `packages/db` (`organization` table: name, url_key, logo_url, allowed_auth_services text[], allowed_file_upload_content_types text[], team_creation_role, label_management_role, invitations_role, created_at, updated_at; migration seeding the row from stored settings and dropping the god-mode `app_setting` / `app_secret` rows), `apps/api/src/organization/` (store + REST `GET/PATCH /organization` for the web), `apps/api/src/shared/access.ts` (team creation, label management, invites read the minimum roles), `packages/auth` (`allowedAuthServices` enforcement incl. passkeys, owner magic-link bypass; Google credentials from env), `apps/api/src/settings/storage.ts` (limits from env, upload types from the organization), GraphQL `resolvers/organization.ts` (`organization`, `organizationUpdate`), `.env.example`, compose files.

**Interfaces (Produces):** `getOrganization(): Promise<OrganizationRow>`, `updateOrganization(patch, actor): Promise<OrganizationRow>`, `minimumRole(action: 'teamCreation' | 'labelManagement' | 'invitations'): Promise<WorkspaceRole>`.

- [ ] **Step 1: Write the failing tests** `apps/api/src/organization/__tests__/integration/organization.test.ts` and `apps/api/src/graphql/__tests__/integration/organization.test.ts`:
  - `reads and updates the organization` — admin `organizationUpdate({ name, urlKey, logoUrl, allowedFileUploadContentTypes })`; `organization` returns them; a member → FORBIDDEN.
  - `maps the security settings` — `securitySettings: { teamCreationRole: admin }` → `restrictTeamCreationToAdmins` true; a member's `teamCreate` and `POST /teams` refused; `invitationsRole: admin` → member's invite refused; `labelManagementRole: owner` → admin's label create refused; `guest` / `app` → INVALID_INPUT.
  - `limits sign-in services` — `authSettings: { allowedAuthServices: ['google'] }` → a member's magic-link request sends nothing; an owner's still works; passkey sign-in refused for a member.
  - `uses upload limits from the environment` — `MAX_ATTACHMENT_MB=1` → a 2 MB upload refused (object-store dependent: assert the size check before storage, or skip if the store is required).
  - `rejects unsupported organization fields` — `organizationUpdate({ samlEnabled ... })` or another listed field → INVALID_INPUT naming it.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: Organization settings, with secrets and limits from the environment`

### Task 3: Remove god mode; web sign-in and workspace settings

**Files:** delete `apps/api/src/god/`, instance keyboard shortcuts (`settings/hotkeys.ts` and its route), update checks (`settings/updates.ts`, any worker job), the god-mode user/team routes; keep the running version route; `apps/web`: delete `features/god`, `app/god`, god navigation; new workspace settings page (name, URL key, logo, allowed sign-in methods, allowed upload types, the three minimum roles, read-only approved domains and version) for admins/owners; sign-in / sign-up pages become "email me a link" + Google + passkey; invite page pre-fills the email and uses the magic link; delete password forms (account security password form, forgot/reset password, email verification screens); docs (README upgrade note: set email/Google env vars), AGENTS.md files.

- [ ] **Step 1: Write the failing test:** extend `apps/api/src/__tests__/integration/removed-features.test.ts` — `/god/*` routes and the instance shortcuts and update routes → 404; the version route still answers.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Delete and build the web pages**; grep `apps/web/src` for `/god`, `password`, `signIn.email`, `signUp.email`, `hotkeys/instance` (Expected: no matches beyond unrelated words).
- [ ] **Step 4: Run** root `format:check`, `lint`, `typecheck`, `build`, full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove god mode; passwordless sign-in and workspace settings in the web app`

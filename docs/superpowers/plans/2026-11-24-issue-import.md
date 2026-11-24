# Issue Import and the Sidebar's Try Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can add confirmed extra email addresses; owners and admins import issues once from GitHub (Linear's GitHub Import App flow), GitLab, Gitea and Forgejo (pasted token), with a people-matching step, and the sidebar gains Linear's Try section with Import issues and Invite people.

**Architecture:** A source-agnostic import engine in `apps/api/src/imports/` turns normalised source data plus a people mapping into issues, comments, labels and link attachments inside an import context that suppresses workflows, notifications and webhooks. Source clients (GitHub, Gitea/Forgejo, GitLab) fetch and normalise. GitHub is driven through Linear's SDL (`integrationGithubImportConnect`, `integrationGithubImportRefresh`, `issueImportCreateGithub`, `issueImportProcess`); the other three and the read side (import list, progress, people, repositories) through `/api/auth/instance/imports*`. Jobs are rows of an `issue_import` table resolved as Linear's `IssueImport`; they run as background tasks in the API process with tokens held in memory.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga (Linear's SDL, never edited), better-auth instance plugin; Next.js 15, React 19, TanStack Query 5, gql.tada; `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-24-issue-import-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations.
- No source token is written to the database or logged (the GitHub App's own credentials come from env).
- An import runs no workflow automation and sends no notification or webhook of any kind; matched creators / assignees are subscribed without notifications.
- Re-running an import of the same repository into the same team creates no duplicate (dedupe on the source issue URL of the link attachment within the team).
- Status values: `inProgress` (fetching, then awaiting people matching), `inProcess` (creating records), `complete`, `error`. On API startup, `inProgress` / `inProcess` rows become `error` with "Interrupted, run the import again".
- Owners and admins only (the API refuses others); hosts may be private or internal, http or https, redirects not followed.
- One running import (`inProcess`) per destination team.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A source token appearing anywhere persistent: DB rows (`serviceMetadata`, `error`, `errorMetadata`), logs, error messages returned to the client, webhook payloads. Test in Task 4 (assert the token string is absent from the stored row and the error after a failing fetch).
2. Rate limiting and pagination: a source returning 429 / 403 with reset headers and multi-page results imports every issue exactly once. Test in Task 4 (stub server pages and a 429).
3. Re-run after an interruption: an import stopped half-way, run again, ends with each source issue once and its comments once. Test in Task 3.
4. A source person matched to a member who is not in the destination team, or a member removed between matching and processing: issue unassigned, not an error. Test in Task 3.
5. Very long or odd content: titles over the API's limit, empty bodies, HTML in GitLab descriptions, labels with colours in different formats (`#fff`, `ff0000`, none). Test in Task 3 (normaliser) and Task 4 (client mapping).

---

### Task 1: Extra email addresses

**Files:** `packages/db` (`user_email`: id, user id, email (unique, lowercased), verified at, token hash, token expiry, created at), `apps/api/src/accounts/emails.ts` (add → send confirmation link; confirm by token; remove; list own), instance plugin endpoints `GET /instance/account/emails`, `POST /instance/account/emails/add`, `POST /instance/account/emails/remove`, `GET /instance/account/emails/confirm?token` (redirects to the profile page with a result), mail template in `packages/mailer`; web Settings → Account → Profile "Email addresses" section; `memberEmails(userIds)` for the import engine (sign-in + confirmed extra addresses).

**Interfaces:** Produces `memberEmails(userIds: string[]): Promise<Map<string, string[]>>` (lowercased; confirmed only).

- [ ] **Step 1: Failing tests** (API): add sends a mail with a link (mail captured in tests) and lists the address as pending; confirm with the token marks it verified; an expired or wrong token fails; adding another user's sign-in or extra address fails; an 11th address fails; remove deletes it; another user cannot list or remove it; `memberEmails` returns only confirmed extras plus the sign-in address; the token is stored hashed. Web: a helper for the row status text.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite, web tests, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: extra email addresses for import matching`

### Task 2: Original dates and the import context

**Files:** `apps/api/src/shared/workflow-context.ts` (or a sibling `import-context.ts`): `runAsImport(importId, run)`, `currentImport()`; the webhook emitter (`webhooks/event.ts`) and notification writers (`notifications/*`) skip inside it, as does the workflow engine; `issues/store.ts` `createIssue` and `comments/store.ts` `createComment` accept `createdAt` / `completedAt`; GraphQL `issueCreate` (`createdAt`, `completedAt`) and `commentCreate` (`createdAt`) pass them with Linear's rules.

**Interfaces:** Produces `runAsImport<T>(importId: string, run: () => T): T`, `currentImport(): string | undefined`; `createIssue(…, { createdAt?: Date; completedAt?: Date })`, `createComment({ …, createdAt?: Date })`.

- [ ] **Step 1: Failing tests** (API integration): `issueCreate` with `createdAt` in the past stores it; in the future → INVALID_INPUT; `completedAt` without a completed state → INVALID_INPUT; `completedAt` before `createdAt` → INVALID_INPUT; `commentCreate` with `createdAt`; inside `runAsImport`: creating an issue with an assignee sends no notification, no webhook delivery is queued for Issue / Comment / Attachment / IssueLabel, no workflow rule runs, and the assignee is subscribed.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite (object-store tests excepted), root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): original dates on issueCreate and commentCreate, and an import context`

### Task 3: Import jobs and the engine

**Files:** `packages/db` (`issue_import`: id, service, status, progress, team id or team name, creator, display name, service metadata (repository, host — never a token), mapping (people), summary, error, timestamps; `issue_activity` / history link to the import for created issues), `apps/api/src/imports/{store.ts, engine.ts, normalize.ts, types.ts}`, GraphQL `IssueImport` resolution in `IssueImportPayload` and `IssueHistory.issueImport`; startup sweep in the API's boot.

**Interfaces:** Produces
- `type SourcePerson = { key: string; login: string; name: string | null; email: string | null }`
- `type SourceComment = { author: SourcePerson; body: string; createdAt: string }`
- `type SourceIssue = { url: string; number: number; title: string; body: string; state: 'open' | 'closed' | 'notPlanned'; labels: { name: string; color: string | null }[]; author: SourcePerson; assignee: SourcePerson | null; createdAt: string; closedAt: string | null; comments: SourceComment[] }`
- `type SourceData = { serviceLabel: 'GitHub' | 'GitLab' | 'Gitea' | 'Forgejo'; issues: SourceIssue[] }`
- `suggestPeople(people: SourcePerson[], members: { id: string; emails: string[]; name: string }[]): Record<string, string | null>`
- `processImport(importId: string, data: SourceData, people: Record<string, string | null>): Promise<ImportSummary>` (inside `runAsImport`; updates progress; dedupes by link URL; labels by name, created with normalised colour; state mapping per spec; comment prefix "**Name** on GitHub wrote:"; title truncated to the API limit with the rest prepended to the body)
- `type ImportSummary = { issues: number; skippedExisting: number; comments: number; labelsCreated: number; skipped: { url: string; reason: string }[] }`
- store: `createImport`, `setImportStatus`, `setImportProgress`, `listImports`, `getImport`, `sweepInterruptedImports`

- [ ] **Step 1: Failing tests** (API integration with a fake `SourceData`): two issues, one closed, one "not planned", labels (one existing by different case, one new with `#ABC`), comments with dates, people mapped / unmapped / mapped to a non-team member → expected states, labels, dates, assignee, creator, comment prefixes, link attachments, summary; run twice → no duplicates (`skippedExisting`); interrupted half-way (throw after the first issue) then run again → each issue once; `sweepInterruptedImports` turns `inProcess` into `error`; `IssueHistory.issueImport` on an imported issue; `suggestPeople` by sign-in email, by a confirmed extra email (from `memberEmails`, Task 1), by exact name / login, none.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): issue import jobs and engine`

### Task 4: Gitea / Forgejo and GitLab sources and the instance endpoints

**Files:** `apps/api/src/imports/sources/{gitea.ts, gitlab.ts, http.ts}` (paging, 403 / 429 with reset headers, no redirects, http and https, timeouts), `apps/api/src/imports/handlers.ts`, instance plugin endpoints in `packages/auth/src/instance-plugin.ts`: `GET /instance/imports` (list with progress and summary), `GET /instance/import?id`, `POST /instance/imports/repositories` (host, token → repos), `POST /instance/imports/start` (service, host, token, repo, team id or name, include closed, labels → import id; fetch runs in background, then status awaits matching), `GET /instance/import/people?id` (people with issue counts and suggestions), `POST /instance/imports/process` (id, people mapping → processing). Tokens kept in an in-memory map keyed by import id and dropped when the import ends.

**Interfaces:** Consumes Task 3. Produces `fetchGitea(host, token, repo, opts): Promise<SourceData>`, `fetchGitlab(host, token, projectPath, opts): Promise<SourceData>`, `listGiteaRepos`, `listGitlabProjects`.

- [ ] **Step 1: Failing tests** against a local stub HTTP server (Bun.serve in the test): Gitea paging over 3 pages, pull requests skipped, closed included / excluded, a 429 then success; GitLab paging, `closed` vs `opened`, merge requests absent, label colours; a redirect response is not followed (error); the instance endpoints refuse a member (403) and a guest; full flow start → people → process ends `complete` with the summary; the token string is absent from the stored row, the error text and the list response.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: GitLab, Gitea and Forgejo issue import`

### Task 5: GitHub through Linear's import model

**Files:** env (`GITHUB_IMPORT_APP_ID`, `GITHUB_IMPORT_APP_SLUG`, `GITHUB_IMPORT_CLIENT_ID`, `GITHUB_IMPORT_CLIENT_SECRET`, `GITHUB_IMPORT_PRIVATE_KEY`) in `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml`; `apps/api/src/imports/sources/github.ts` (app JWT, installation token, repos, issues REST API with `state_reason`, paging, rate limits); integration storage (an `integration` row for service `githubImport` with installation id, no user token stored) and GraphQL `integrationGithubImportConnect(code, installationId)` (exchange the code to confirm the user authorized the installation, then store), `integrationGithubImportRefresh(id)`, `issueImportCreateGithub(...)` (fetch → awaiting matching), `issueImportProcess(issueImportId, mapping)` (`mapping.people`); OAuth callback page route in the web (`/settings/workspace/import/github/callback`) that calls the connect mutation; `docs/github-import-setup.md` (app permissions Issues read-only and Metadata read-only, callback URL, env vars); instance endpoints list GitHub repositories of the installation for the page.

**Interfaces:** Consumes Tasks 3–4 (engine, people, list endpoints).

- [ ] **Step 1: Failing tests** with a stub GitHub API (Bun.serve; the client takes a base URL from config for tests): connect stores the integration; refresh lists repos; `issueImportCreateGithub` → payload `issueImport.status = inProgress`, then people available; `issueImportProcess` → `complete`; `state_reason: not_planned` → canceled; pull requests skipped; a member calling the mutations → FORBIDDEN; without the env vars → a clear error "GitHub imports are not set up on this instance".
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: GitHub issue import through Linear's import model`

### Task 6: Import page

**Files:** `utils/settingsNav.ts` (Workspace → Import, owners and admins), route `app/settings/workspace/import/page.tsx`, `features/imports/` (services on the SDL mutations and the instance endpoints; source picker; GitHub connect / disconnect and repo picker; host + token + repo picker for the other three; team picker or new team name; include closed; label filter; people matching step with suggestions; imports list with status, progress, summary; polling every 2 s while any import is `inProgress` / `inProcess`).

**Interfaces:** Produces `importStatusText(imp): string` ("Fetching issues…", "Match people to continue", "Imported 120 of 450 issues", "Complete", error text) and `peopleMappingInput(rows): Record<string, string | null>` in `features/imports/utils/`.

- [ ] **Step 1: Failing tests** for the two helpers and the nav gating (owner / admin yes, member / guest no).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** The token field is `type="password"`, never stored in query caches or local storage, cleared after start.
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): import page`

### Task 7: Sidebar Try section, Invite people, smoke check

**Files:** `components/layout/AppSidebar.tsx` + a `SidebarTrySection.tsx` (collapsible "Try", bottom of the sidebar, collapsed state kept like the other sections; Import issues → `/settings/workspace/import`; Invite people → dialog with the existing invite form from the members settings); gating helper.

**Interfaces:** Produces `tryItems(viewer: { role: WorkspaceRole; canInvite: boolean }): ('import' | 'invite')[]`.

- [ ] **Step 1: Failing tests** for `tryItems` (owner both, member with invite rights only invite, guest none → section hidden).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check: a stub Gitea server in the scratchpad (Bun.serve emulating `/api/v1/repos/search`, `/repos/{o}/{r}/issues`, comments) with 3 issues, labels and comments; in headless Chrome import into ENG through the page (people step, then process), see the imported issues with dates, labels, comments and link back, re-run → nothing duplicated; the Try section with both items; Invite people dialog sends an invite; GitHub source without env shows the setup message. Screenshots — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sidebar Try section with import and invite`

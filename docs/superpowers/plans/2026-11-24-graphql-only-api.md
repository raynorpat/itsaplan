# Project 7 (MCP and tests on GraphQL, REST removed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/graphql` is the instance's only data API: MCP runs Linear's tool set on GraphQL, every test uses GraphQL, and the REST routes, OpenAPI document and API docs page are gone.

**Architecture:** Task 1 adds GraphQL test setup helpers and `read` on every OAuth grant. Task 2 rebuilds MCP on GraphQL. Tasks 3–4 move the REST tests area by area (rewrite or delete). Task 5 deletes REST, mounts the kept file and internal routes on their own, updates the docs and runs the gates.

**Tech Stack:** Bun, Elysia, graphql-yoga with Linear's SDL, MCP SDK (Streamable HTTP), better-auth; Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-24-graphql-only-api-design.md`

## Global Constraints

- Linear's SDL is never edited. No new GraphQL features.
- MCP tools: `list_issues`, `list_my_issues`, `get_issue`, `create_issue`, `update_issue`, `list_comments`, `create_comment`, `list_projects`, `get_project`, `create_project`, `update_project`, `list_project_labels`, `list_teams`, `get_team`, `list_users`, `get_user`, `list_issue_statuses`, `get_issue_status`, `list_issue_labels`, `create_issue_label`, `list_cycles`, `list_documents`, `get_document`. Each runs GraphQL in process as the caller with the caller's credential. Names / keys / ids accepted as the spec says; ambiguous people return candidates.
- `/mcp/readonly` lists and runs read tools only. `read` is always part of an OAuth grant.
- Kept routes: `/graphql`, `/api/auth/*`, `/mcp`, `/mcp/readonly`, OAuth paths and discovery, health, `PUT /uploads/:token`, `GET /uploads/:id/raw`, `GET /avatars/:id/raw`, `GET /attachments/:publicId/raw`, the four `/internal/*` worker routes. Everything else REST goes.
- Every rule a REST test protected keeps a test (GraphQL, MCP, better-auth, worker or a kept route).
- Follow AGENTS.md files. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. An MCP tool never succeeds where the same credential is refused on `/graphql` (scope, team visibility, guest, app user). Test in Task 2.
2. `/mcp/readonly` cannot run a write tool even if the client calls it by name. Test in Task 2.
3. `update_issue` with an ambiguous person, state or label name changes nothing and returns the candidates. Test in Task 2.
4. After REST is deleted, the web, the worker and the Docker test gate still work: uploads, avatars, attachment downloads, notification delivery, cycle upkeep, upload cleanup. Checked in Task 5 (smoke test and the compose test gate).
5. The count of tested rules does not drop: each deleted REST test file is listed in the ledger with the test(s) that now cover its rules, or the reason the rule went with REST. Checked in Tasks 3–4.

---

### Task 1: GraphQL test helpers, `read` on every grant

**Files:** `apps/api/src/__tests__/helpers/` (GraphQL setup helpers: sign in / user with role, team (public / private), member, state, label, issue, comment, project, cycle, document, initiative, view, webhook; a `gql(as, query, vars)` caller), move the GraphQL tests that set up data through REST onto them; `packages/auth/src/oauth.ts` (`read` added to every grant; tokens without it are read as having it).

- [ ] **Step 1: Write the failing tests**: an `issues:create`-only token can run `teams` (read now implied); helper self-tests (each helper creates through GraphQL and returns ids).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; switch GraphQL tests' setup to the helpers.
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `test(api): GraphQL setup helpers; read on every OAuth grant`

### Task 2: MCP on GraphQL

**Files:** `apps/api/src/mcp/` rebuilt: tool definitions (one file per area: issues, comments, projects, teams/users, statuses/labels, cycles/documents), shared name resolution (team key/name/id; person id/email/partial name with candidates; state / label / project / cycle by name within the team), GraphQL in-process runner with the caller's credential, `/mcp` and `/mcp/readonly` mounts, protected-resource metadata for `/mcp/readonly`, instructions rewritten for the new tools (keep the workflow rules), `completedAt` duration → date. Delete `generate.ts`, `dispatch.ts`, the REST identity plumbing (`runAsMcpCaller`, the MCP exception in `authContext`), and `x-mcp` tags on routes.

- [ ] **Step 1: Write the failing tests** (`mcp/__tests__/…`): tool list on `/mcp` and `/mcp/readonly`; each tool's happy path; name resolution incl. ambiguity (Review Focus 3); scope and visibility parity with `/graphql` for a read token, an `issues:create` token, a guest and an app user (Review Focus 1); write tool by name on `/mcp/readonly` refused (Review Focus 2); `completedAt: '-P7D'`; OAuth 401 metadata for both paths; API key bearer works.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): MCP on GraphQL with Linear's tool set`

### Task 3: Move REST tests — issues, comments, labels, states, teams, members, workspace

**Files:** REST test files under `issues`, `comments`, `labels`, `states`, `teams`, `members`, `workspace`, `organization`, `invites`, `user-preferences`, `notification-preferences`, `shared`, and root `__tests__/integration` files that call REST: each rewritten on GraphQL with the Task 1 helpers, or deleted where a GraphQL test covers the same rules, or deleted with a REST-only route (ledger each: file → covering tests or reason).

- [ ] **Step 1:** For each file, list its rules and the GraphQL test that covers each; write missing GraphQL tests first and watch them pass against the current code (they protect existing behaviour, so they pass; a failing one is a GraphQL bug — fix it, ledger).
- [ ] **Step 2: Run** the new / changed tests — Expected: PASS.
- [ ] **Step 3:** Delete or rewrite the REST files.
- [ ] **Step 4: Run** the full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `test(api): issue, team and workspace tests on GraphQL`

### Task 4: Move REST tests — projects, initiatives, cycles, documents, attachments, notifications, webhooks, views, uploads

**Files:** the remaining REST test files (same rules as Task 3), incl. worker-facing tests moving to the internal routes through `app.handle`.

- [ ] **Steps 1–4:** as Task 3.
- [ ] **Step 5: Commit** `test(api): project, cycle, webhook and notification tests on GraphQL`

### Task 5: Delete REST, keep file and internal routes, docs, gates

**Files:** remove every REST route module's routes, `planner.ts` REST mount, OpenAPI / Scalar setup, REST-only store code with no other caller, Eden Treaty dependency; mount the kept file routes and internal routes with the session and error handling they need; web: remove the API docs page and its nav entry; README, AGENTS.md files, `.env.example`; compose files and Dockerfiles if they reference removed paths.

- [ ] **Step 1: Write the failing tests**: kept routes respond (upload PUT, raw file GETs incl. permission checks, internal routes with the worker token); removed paths answer 404 (`/teams`, `/issues/...`, `/docs`, `/me`, `/auth-config`).
- [ ] **Step 2: Run** — Expected: FAIL (removed paths still answer).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite, web tests, root `format:check`, `lint`, `typecheck`, `build`; the compose test gate (`docker compose -f docker-compose.test.yml build` and `run --rm api-test`; this also exercises the object-store tests) if Docker is available, else ledger; HTTP smoke test against the test DB (API 3100, web 3101, worker; port 3000 taken; magic link from the API log): web pages load (board, issue page with an attachment upload and download, account avatar, settings), a notification email delivery job runs, an MCP client session lists tools and creates an issue by team key with an API key, `/mcp/readonly` lists read tools only. Stop everything — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove the REST API`

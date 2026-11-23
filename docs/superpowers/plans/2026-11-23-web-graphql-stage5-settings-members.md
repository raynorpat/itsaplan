# Web on GraphQL Stage 5.5 (Settings, Members, Workspace, Account) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web makes no REST call: every remaining `lib/api.ts` method moves to GraphQL or to a better-auth plugin, and `lib/api.ts` is deleted.

**Architecture:** Task 1 adds the API pieces (better-auth instance plugin incl. the team owner change, invite `metadata`, number matching in `searchIssues`). Tasks 2–4 move the web pages area by area; Task 4 deletes `lib/api.ts` and runs the smoke test. Pure logic in feature utils with unit tests.

**Tech Stack:** Bun, Elysia, better-auth, graphql-yoga with Linear's SDL; Next.js 15, React 19, TanStack Query 5, gql.tada; Bun tests (API) and node:test (web).

**Spec:** `docs/superpowers/specs/2026-11-23-web-graphql-stage5-settings-members-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes.
- Instance plugin under `/api/auth/*`: sign-in options (public), app version, upload limits, team owner change — same values, rules and audiences as REST `/auth-config`, `/settings/version`, `/settings/storage`, `setMemberRole` today.
- Invite token and team ids in `OrganizationInvite.metadata`; the token only for the sender and admins.
- `searchIssues` matches "42" and "KEY-42" by number, as REST search does.
- Removing a state: move its issues (`issueBatchUpdate`), then `workflowStateArchive`; no permanent delete; archived states not listed.
- Team General: name, description, visibility, auto-archive; key read-only.
- REST routes stay (project 7); the API docs page and MCP address are unchanged.
- Hide controls the API would refuse (projects 2 and 3). Follow `apps/web/AGENTS.md`, `DESIGN.md`. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A guest or member calling the plugin's team owner change, or a non-admin reading another sender's invite token in `metadata`, is refused / gets no token. Test in Task 1.
2. Sign-in options are readable without a session; version and upload limits are readable by exactly who can read them today. Test in Task 1.
3. Removing a state whose issues fail to move partway leaves the state unarchived and reports which issues did not move. Test in Task 2 (helper over `runBulk`).
4. Reordering states sends `position` values that keep the order after a refresh, incl. moving to first and last. Test in Task 2 (position helper).
5. After `lib/api.ts` is deleted, no web file fetches a REST path (grep for `API_URL}/` and `fetch(` outside `lib/graphql.ts`, the auth client and the upload PUT). Checked in Task 4.

---

### Task 1: API — instance plugin, invite metadata, search by number

**Files:** `packages/auth/src/instance-plugin.ts` (better-auth plugin with `createAuthEndpoint`: `GET /instance/sign-in-options`, `GET /instance/version`, `GET /instance/upload-limits`, `POST /instance/team-owner` `{ teamId, userId, owner }`; reuse the REST handlers' logic, not copies — call the same store functions), registered in `packages/auth/src/index.ts`; `apps/api/src/graphql/resolvers/workspace.ts` / invite resolver (`metadata: { token?, teamIds }`), `issues/store.ts` or the GraphQL search (number / identifier match).

**Interfaces (Produces):** the four endpoints and their JSON shapes (same as the REST responses; owner change returns the membership); `OrganizationInvite.metadata.token` / `.teamIds`; `searchIssues(term: "42" | "KEY-42")` hits by number.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/__tests__/integration/instance-plugin.test.ts`, `graphql/__tests__/integration/invite-metadata.test.ts`, `search-number.test.ts`): sign-in options without a session; version and limits with the same auth as REST; owner change by a team owner / admin succeeds, by a member is refused, guest refused, mirrors `changeTeamOwner` rules; invite token visible to sender and admin, absent for another member; team ids present; `searchIssues("42")` and `("KEY-42")` find issue 42, title search unchanged.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat(api): instance endpoints on better-auth, invite metadata, search by number`

### Task 2: Web — instance info, team list, team General, states, labels

**Files:** `services/authConfig.service.ts`, `version.service.ts`, `storage.service.ts` on the auth client plugin (`packages/auth` client plugin or `authClient.$fetch`); `services/teams.service.ts` (`teams`, `teamCreate`, `teamUpdate`, `teamDelete`); `features/settings` General, States (create / edit / reorder by `position` / remove = move issues then archive; import dialog), Labels and groups (`issueLabel*`, `isGroup`, `parentId`; import dialog); delete the REST methods no caller uses.

**Interfaces (Produces):** `positionForMove(states, from, to)`, `removeState(stateId, targetId, issueIds) → { moved, failed }`.

- [ ] **Step 1: Write the failing tests**: `positionForMove` first / middle / last; `removeState` with a failing chunk does not archive and reports the failed ids; label group form → input.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): instance info, teams, states and labels on GraphQL`

### Task 3: Web — webhooks, members, workspace users, invites, organization

**Files:** `services/webhooks.service.ts` (team and `allPublicTeams`, rotate secret), `services/members.service.ts` (`team.memberships`, `teamMembershipCreate` / `Delete`, join = create for the viewer, owner change via the plugin), `features/workspace` (users, `userChangeRole`, `userSuspend` / `Unsuspend`; invites via `organizationInvites` / `Create` / `Delete` with `metadata`; organization via `organization` / `organizationUpdate`), `features/invite` (`organizationInviteDetails` before sign-in); delete the REST methods no caller uses.

- [ ] **Step 1: Write the failing tests** for pure helpers added (e.g. invite row from `metadata`: link only with a token; memberships → member rows with owner flag and `canManage`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): webhooks, members, workspace and invites on GraphQL`

### Task 4: Web — account, search, delete `lib/api.ts`

**Files:** notification preferences (`userSettings` / `userSettingsUpdate`), timezone (`userUpdate`), avatar (`fileUpload` + PUT + `userUpdate avatarUrl`; remove = null) in `features/account`; issue search and command palette on `searchIssues`; remaining `getTeamSettings` / `updateTeamSettings`; move `ApiError`, `API_URL` / `resolveApiUrl` and still-used types to their users (`lib/graphql.ts`, services); delete `lib/api.ts`.

- [ ] **Step 1: Write the failing tests** for pure helpers added (preferences form ↔ `notificationCategoryPreferences`; avatar size check against the plugin's limits).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, delete `lib/api.ts`.
- [ ] **Step 4: Run** web tests, root checks, full API suite; grep per Review Focus 5 — none; HTTP smoke test against the test DB (API 3100, web 3101; port 3000 is taken; magic link from the API log): sign-in options before sign-in; version; limits; create a team, edit General, add / reorder / remove a state (issues moved), labels and a group, a team and an all-teams webhook with rotate; add a member, make them owner via the plugin, remove; invite with link copy and the invite page before sign-in; change a workspace role, suspend / unsuspend; organization update; notification preferences, timezone, avatar upload and removal; search "KEY-1"; fetch the settings, members, workspace, account pages and `/invite/<token>` — 200, no dev-server errors. Stop both servers — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): account and search on GraphQL; remove the REST client`

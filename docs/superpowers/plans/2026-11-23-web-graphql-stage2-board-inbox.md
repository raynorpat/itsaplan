# Web on GraphQL Stage 5.2 (Board and Inbox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The work-items screens, saved views, issue creation, card moves, bulk actions and the inbox run on GraphQL, with request-scoped batching on the API.

**Architecture:** Task 1 adds per-request loaders to the GraphQL context and uses them in the per-row field resolvers. Task 2 moves the board's data (scaffold + all active issues, paged) and saved views; Task 3 moves its writes; Task 4 moves the inbox to one workspace inbox. Pure logic (paging, cache patching, bulk chunking, inbox filters and counts) lives in feature utils with unit tests.

**Tech Stack:** graphql-yoga, Drizzle; Next.js 15, React 19, TanStack Query 5, gql.tada; Bun tests (API) and node:test (web).

**Spec:** `docs/superpowers/specs/2026-11-23-web-graphql-stage2-board-inbox-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` must pass.
- Board: all active issues of the team, 250 per page; filtering, grouping, sorting in the browser.
- Refresh: changed-since every 60 s; full reload every 5 min; after own edits / drags patch the cache from the mutation response; full reload only after own create, delete, archive or move to another team.
- Subscribers filter: while active, ask `issues(filter: { team, subscribers: { some: { id: { in } } } })` for ids only.
- Bulk edits: `issueBatchUpdate` chunks of 50; bulk archive / delete loop; report which issues failed.
- Inbox: one workspace inbox at `/inbox` (per-team route redirects); all unarchived notifications loaded in pages; filters and unread badge in the browser; "Archive all read" / "Archive read for completed issues" replace the delete actions.
- Follow `apps/web/AGENTS.md`; helpers used by one feature stay in that feature.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A team with more than 250 active issues shows all of them on the board. Test in Task 2 (paging helper with a mocked request).
2. A card drag that fails on the server snaps back and shows the error; a refresh landing mid-drag does not undo the move. Test in Task 3 (cache-patch helper and in-flight guard).
3. A bulk edit of 120 issues where one fails reports exactly that issue and applies the rest. Test in Task 3 (bulk chunk helper).
4. The issue-list query makes a bounded number of database queries regardless of issue count. Test in Task 1 (API test counting queries for 5 vs 50 issues).
5. Snoozed notifications stay hidden until their time, then reappear unread-counted without a reload. Test in Task 4 (inbox filter helper with a fixed `now`).

---

### Task 1: Request-scoped batching in the API

**Files:** `apps/api/src/graphql/loaders.ts` (or the `dataloader` package), `graphql/context.ts` (loaders per request), per-row resolvers in `resolvers/issue.ts`, `history.ts`, `comment.ts`, `reaction.ts`, `team.ts` / `user` helpers.

**Interfaces (Produces):** `ctx.loaders` with `state`, `team`, `user` (visibility-checked for the viewer), `labelsByIssue`, `project`, `milestone`, `cycle`, `issue` (parent), `reactionsByComment`, `reactionsByIssue`.

- [ ] **Step 1: Write the failing test** `apps/api/src/graphql/__tests__/integration/batching.test.ts`: count SQL statements (wrap the db client or use a query logger in tests) for `issues(first: 50) { nodes { state { id } team { id } assignee { id } labels { nodes { id } } project { id } cycle { id } parent { id } } }` with 5 issues and with 50 issues — the counts are equal (bounded); same for `issue.history` and `issue.comments { nodes { user { id } reactions { id } } }`.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/batching.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the loaders and switch the per-row resolvers to them (visibility rules unchanged).
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `perf(api): batch per-row GraphQL fields per request`

### Task 2: Board, table, calendar and timeline reads; saved views

**Files:** `apps/web/src/services/teams.service.ts` (scaffold via `team(id: key)` + `viewer`; manage rights per project 2), a board issues service (all active issues, 250 per page), the archive page (`archivedAt` filter), saved views on `customViews` with the project 4 converter and view preferences, the subscribers filter (filter bar field + server id query while active), `useChangedSince` for the board, delete the REST board / scaffold / views methods no caller uses.

**Interfaces (Produces):** `fetchAllPages(fetchPage, pageSize = 250)`, `useBoardIssues(teamKey)`, `useTeamScaffold(teamKey)`, `useSubscribedIssueIds(teamKey, userIds | null)`.

- [ ] **Step 1: Write the failing tests** (web, node:test): `fetchAllPages` follows `endCursor` until `hasNextPage` is false (3 pages → all items, in order); subscribers filter helper (`matchesSubscribers(issue, idSet)`), view round trip through the converter for a view with the new subscribers condition.
- [ ] **Step 2: Run** `cd apps/web && bun test src` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the board, views and archive on GraphQL`

### Task 3: Board writes and bulk actions

**Files:** card moves and inline edits (`issueUpdate` with `stateId`, `sortOrder`, fields) patching the board cache from the response; `issueCreate` (new-issue modal and quick add); bulk edits via `issueBatchUpdate` in chunks of 50; bulk archive / delete loops; error reporting naming failed issues; delete the remaining REST issue write methods no caller uses.

**Interfaces (Produces):** `patchIssueInList(list, issue)`, `chunk(ids, 50)`, `runBulk(ids, run) → { done: string[]; failed: { id; message }[] }`.

- [ ] **Step 1: Write the failing tests**: `patchIssueInList` replaces by id and moves between groups; an in-flight guard drops a refresh result older than a pending mutation; `runBulk` over 120 ids with one failing chunk member reports exactly that id and returns the rest as done.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): board writes and bulk actions on GraphQL`

### Task 4: One workspace inbox on GraphQL

**Files:** `apps/web/src/features/inbox/` (all unarchived notifications paged; filters unread / snoozed / type in the browser; unread badge; read, snooze presets, archive / unarchive; selection with bulk read / archive / snooze; "Mark all as read" per issue; "Archive all read" and "Archive read for completed issues"), `/inbox` route, the per-team inbox route redirects to `/inbox`, the shell's unread badge, delete the REST notification methods no caller uses.

**Interfaces (Produces):** `visibleNotifications(list, { unreadOnly, showSnoozed, types }, now)`, `unreadCount(list, now)`.

- [ ] **Step 1: Write the failing tests**: snoozed until later → hidden and not counted; snooze passed → visible and counted if unread; archived never shown; type filter; "read for completed issues" selector picks only read notifications whose issue's state type is completed or canceled.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; HTTP smoke test against the test DB (API 3100, web 3101; port 3000 is taken): sign in by magic link, create a team with 260 issues via GraphQL, load the board data and confirm all 260 arrive, drag (issueUpdate) one, bulk edit 60, create a view, generate notifications for a second user and exercise the inbox actions; pages `/team/<KEY>`, `/inbox` render — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): one workspace inbox on GraphQL`

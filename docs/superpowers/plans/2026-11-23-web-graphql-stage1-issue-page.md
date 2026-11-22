# Web on GraphQL Stage 5.1 (Issue Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The issue page and every surface sharing its cache run on GraphQL, with comments, reactions, relations, link attachments, documents and subscriptions added.

**Architecture:** `gql.tada` types documents from Linear's SDL; `lib/graphql.ts` sends them with the session cookie; feature services hold the documents next to TanStack Query hooks; a shared `useChangedSince` keeps lists fresh. Pure logic (error mapping, list merge, feed merge, history text) lives in utils with unit tests; components are checked by typecheck, build and an HTTP smoke test.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, gql.tada, Bun tests; API: graphql-yoga with Linear's SDL.

**Spec:** `docs/superpowers/specs/2026-11-23-web-graphql-stage1-issue-page-design.md`

## Global Constraints

- Schema: `apps/api/src/graphql/schema.graphql` (never edited); `gql.tada`'s generated type file checked in.
- `gqlRequest` posts to `${NEXT_PUBLIC_API_URL}/graphql` with `credentials: 'include'`; maps `extensions.code` to the web's existing error type; AUTHENTICATION_ERROR behaves as a REST 401 does today.
- Refresh: changed-since every 60 s; full refetch every 5 min while visible, on return after 5 min hidden, and after the viewer's own create / delete / move.
- `qk.issue(id)` holds only the GraphQL issue shape; every surface reading it moves in this stage.
- History detail is Linear's (no description text; deleted items shown as removed); best-effort id backfill migration for old activity rows.
- Hide controls the viewer cannot use (roles, visibility, team management); the API stays the authority.
- Follow `apps/web/AGENTS.md` (one component per file, feature structure, imports) and `DESIGN.md`.
- Incremental migrations only. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A GraphQL AUTHENTICATION_ERROR (expired session) sends the user to sign in, exactly as a REST 401 does. Test in Task 1 (`gqlRequest` unit test).
2. A full refetch drops an item another user deleted, and a changed-since merge never duplicates or resurrects one. Test in Task 1 (`mergeChanged` unit test).
3. A guest or a user without the needed rights sees no edit, delete or resolve controls they cannot use (comment of someone else, relation to an issue they cannot edit). Checked in Tasks 3–5 by a `can*` helper with unit tests.
4. An upload over the limit or of a disallowed type shows the API's message and creates no attachment. Test in Task 4 (upload helper unit test with a mocked fetch).
5. The feed merges comments and history in time order, with replies under their parent and resolved threads collapsed. Test in Task 2 (`buildFeed` unit test).

---

### Task 1: GraphQL foundation

**Files:** `apps/web/package.json` (`gql.tada`, `@0no-co/graphqlsp` for the editor), `apps/web/tsconfig.json` (gql.tada plugin with the schema path and output file), `apps/web/src/graphql-env.d.ts` (generated), `apps/web/src/lib/graphql.ts`, `apps/web/src/hooks/useChangedSince.ts`, `apps/web/src/utils/mergeChanged.ts`; API only if needed for the web origin on `/graphql` (CORS with credentials, CSRF content-type check) with an API test.

**Interfaces (Produces):** `graphql` (gql.tada tag), `gqlRequest<D>(doc: D, variables?): Promise<ResultOf<D>>`, `class GraphQLRequestError` (or reuse the existing `ApiError` with `status`/`code`), `useChangedSince({ queryKey, fetchAll, fetchChanged, getNodes, getUpdatedAt })`, `mergeChanged<T extends { id: string }>(current: T[], changed: T[]): T[]`.

- [ ] **Step 1: Write the failing tests** `apps/web/src/lib/__tests__/graphql.test.ts` and `apps/web/src/utils/__tests__/mergeChanged.test.ts`:
  - `posts with credentials and returns data` (mock fetch).
  - `maps error codes` — INVALID_INPUT → 400-like with message, FORBIDDEN → 403, ENTITY_NOT_FOUND → 404, AUTHENTICATION_ERROR / HTTP 401 → the same 401 handling as REST.
  - `mergeChanged replaces by id, appends new, keeps order and never duplicates`.
- [ ] **Step 2: Run** `cd apps/web && bun test src/lib src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement**; generate the gql.tada output; verify `/graphql` accepts the web origin with the cookie (API test if a change was needed).
- [ ] **Step 4: Run** web tests, root `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): GraphQL client with gql.tada and changed-since refresh`

### Task 2: Issue page and its surfaces on GraphQL

**Files:** `apps/web/src/features/issue/services/issue.service.ts` (documents + hooks), `IssueDetail`, `IssueProperties`, `IssueDetailContent`, feed (`IssueFeedList`, `IssueActivityFeed`, `ActivityLine`, `utils/activityText.tsx` → history entries), status timeline components (from `stateHistory`, popover filters loaded history), side panel (`ShellOverlays`), inbox detail pane, `useIssueCommands`, shell by-number lookup, `/issue/[issueId]` redirect, `IssueContextMenu` and `DeleteIssueDialog` on an `IssueRef` type with GraphQL mutations; `apps/web/src/utils/feed.ts`; delete REST issue methods no caller still uses; `packages/db` backfill migration (ids for old `issue_activity` rows matched by name within the issue's team).

**Interfaces (Produces):** `IssueRef { id; identifier; teamKey; stateId; title }`, `buildFeed(comments, history): FeedItem[]`, `useIssue(idOrIdentifier)`, `useUpdateIssue()`.

- [ ] **Step 1: Write the failing tests** `apps/web/src/utils/__tests__/feed.test.ts`:
  - `merges comments and history by time`, `nests replies under their parent`, `collapses resolved threads`, `describes history entries` (state change, assignee, labels added/removed, description edited → "updated the description", deleted state → "a removed state").
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; write the backfill migration and check it by hand on the test DB (ledger).
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build`, full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the issue page on GraphQL`

### Task 3: Comments and reactions

**Files:** comment components (`CommentItem`, `CommentComposer`, new reply / edit / thread components), reactions (picker, chip list) for issues and comments, `features/issue/services/comments.service.ts` and a reactions service on GraphQL, `apps/web/src/utils/permissions` helper `canEditComment(viewer, comment)` etc.

- [ ] **Step 1: Write the failing tests** for the `can*` helpers (author may edit/delete own comment; team manager may delete others'; anyone who can see may reply and react; resolve by author or team member per the API's rule) and for `groupReactions(reactions, viewerId)`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** replies, edit, delete, resolve / unresolve, reactions on issue and comments.
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): comment threads and reactions on issues`

### Task 4: Relations, link attachments and uploads

**Files:** a Relations section (list grouped by type, add via issue search `searchIssues`, remove, duplicate hint), the attachments section listing links and files from `issue.attachments` (add link, edit title, delete), uploads via `fileUpload` + `PUT` + `attachmentCreate` in `apps/web/src/utils/upload.ts` (also used by the editor's image picker), delete the REST attachment upload calls the issue page used.

- [ ] **Step 1: Write the failing tests** `apps/web/src/utils/__tests__/upload.test.ts` (mocked fetch): `uploads and creates the attachment`, `surfaces the API's size / type error and creates nothing`, `does not call attachmentCreate when the PUT fails`; and `groupRelations(relations, issueId)` (blocks / blocked by / related / duplicate of / duplicates).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): issue relations, link attachments and GraphQL uploads`

### Task 5: Issue documents and subscriptions

**Files:** a Documents section on the issue (list, create, open in place, edit title and body with the existing editor, delete to trash, comments on a document reusing Task 3's components), a subscribe toggle and subscribers list in the issue header or properties.

- [ ] **Step 1: Write the failing tests** for pure helpers you add (e.g. `documentTitleOrDefault`, subscriber list ordering) — Expected: FAIL first.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; HTTP smoke test against the test DB (API 3100, web 3101): sign in by magic link, create an issue, comment, reply, react, relate, add a link, add a document, subscribe; each GraphQL mutation succeeds and the issue page renders — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): issue documents and subscriptions`

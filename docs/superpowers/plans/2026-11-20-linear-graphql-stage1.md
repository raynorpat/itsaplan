# Linear-compatible GraphQL API, Stage 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Linear's published GraphQL schema at `POST /graphql` with working issue and workflow-state operations, on a data model that uses UUID ids and Linear's integer priority.

**Architecture:** The data model moves to UUID primary keys and gains Linear's issue fields in a single new baseline migration; REST, web, worker, bot and MCP follow. A graphql-yoga endpoint mounted in the api app builds an executable schema from Linear's vendored SDL; resolvers call the existing store functions, so side effects match REST.

**Tech Stack:** Bun 1.x (`/opt/homebrew/bin/bun`; prefix commands with `export PATH=/opt/homebrew/bin:$PATH`), Elysia, Drizzle + PostgreSQL, better-auth, graphql-yoga, `@graphql-tools/schema`, `@linear/sdk` (test-only).

**Spec:** `docs/superpowers/specs/2026-11-20-linear-graphql-stage1-design.md`

## Global Constraints

- Runtime is Bun; never npm/yarn/pnpm. Run workspace tasks from the repo root.
- Agents do not commit (`AGENTS.md`). Each task ends with a proposed Conventional Commit message in chat instead of `git commit`.
- Every entity id is `uuid PRIMARY KEY DEFAULT gen_random_uuid()`; better-auth uses `advanced.database.generateId: "uuid"`.
- `issue.priority` is `integer NOT NULL DEFAULT 0`, check `0..4` (0 none, 1 urgent, 2 high, 3 medium, 4 low). `initiative.priority` stays text.
- No data to keep: `packages/db/drizzle/*` is replaced by one baseline migration.
- The Linear SDL is vendored unmodified at `apps/api/src/graphql/schema.graphql` with its source commit recorded in `apps/api/src/graphql/SCHEMA_SOURCE.md`.
- Page size default 50, max 250. `includeArchived` defaults to false.
- Errors carry `extensions.code` in `AUTHENTICATION_ERROR | FORBIDDEN | ENTITY_NOT_FOUND | INVALID_INPUT | CONFLICT | NOT_IMPLEMENTED` and `extensions.userPresentableMessage`.
- State types stay `backlog | unstarted | started | completed | canceled`.
- Tests are integration tests against a real test Postgres, set up through the API, asserted through the API (`apps/api/AGENTS.md`).

## Review Focus

- A malformed id (`issue(id: "abc")`, REST `/issues/not-a-uuid`) returns not found / 400, never a 500 from a Postgres cast error. → Task 2 and Task 8 tests.
- `issueUpdate(parentId)` that makes an issue its own parent or ancestor is refused with `INVALID_INPUT`. → Task 4 test.
- `issueCreate`/`issueUpdate` with a `stateId` from another team is refused with `INVALID_INPUT`. → Task 9 test.
- `issues(first: 251)` returns `INVALID_INPUT`; `first: 250` succeeds. → Task 8 test.
- `issue(id: "mkt-42")` (lowercase identifier) resolves the same issue as `MKT-42`. → Task 8 test.

---

### Task 0: Local environment and baseline

**Files:** create `.env`, `.env.test`, `apps/web/.env` from their `.example` files (not committed).

- [ ] **Step 1:** Copy the env files; set `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `POSTGRES_PORT=5433`, `DATABASE_URL` on `localhost:5433` (dev DB) and a `*_test` database in `.env.test`.
- [ ] **Step 2:** `docker compose -f docker-compose.dev.yml up -d`; create the test database (`createdb` via `docker compose exec`).
- [ ] **Step 3:** `bun install && bun run db:migrate:test && bun run test`. Expected: the existing suite passes. Record any pre-existing failures; they are not this plan's to fix.

### Task 1: Schema — UUID ids, Linear issue fields, baseline migration

**Files:**
- Modify: `packages/db/src/schema/app.ts`, `packages/auth/src/index.ts` (`advanced.database.generateId: "uuid"`), `packages/db/src/schema/auth.ts` (via `bun run auth:generate`, then hand-fix to `uuid` if the generator emits `text`)
- Delete: `packages/db/drizzle/*`; Create: the new baseline via `bun run db:generate`
- Modify: `apps/api/src/__tests__/helpers/db.ts` (drop `RESTART IDENTITY` wording only if no serials remain)

**Produces:** every table's `id` is `uuid`; every FK column is `uuid`. New columns:
- `issue.parent_id uuid NULL → issue.id ON DELETE SET NULL`, `issue.estimate real NULL`, `issue.creator_user_id uuid NULL → user.id ON DELETE SET NULL`, `issue.started_at`, `issue.completed_at`, `issue.canceled_at timestamptz NULL`, `issue.priority integer NOT NULL DEFAULT 0` + check `issue_priority_check (priority BETWEEN 0 AND 4)`.
- `project_column.description text NOT NULL DEFAULT ''`, `project_column.archived_at timestamptz NULL`. The `unique(project_id, position)` constraint becomes a partial unique index `WHERE archived_at IS NULL`.

- [ ] **Step 1:** Convert every `serial('id')` to `uuid('id').primaryKey().defaultRandom()` and every `integer(... ).references(...)` id column to `uuid`. Non-id integers (`position`, `next_sequence`, `sequence_number`, counts) stay integers.
- [ ] **Step 2:** Add the new columns above.
- [ ] **Step 3:** Delete `packages/db/drizzle/*`, run `bun run db:generate`. Expected: exactly one SQL file plus `meta/`.
- [ ] **Step 4:** Drop and recreate the dev and test databases; `bun run db:migrate && bun run db:migrate:test`. Expected: both succeed.
- [ ] **Step 5:** `bun --filter='@repo/db' run typecheck` (or `tsc` in the package). Expected: passes. App packages fail typecheck until Task 2/3.

Proposed commit: `feat!: use uuid ids and Linear issue fields in a new baseline schema`

### Task 2: API, worker, bot follow UUID ids and integer priority

**Files:** every `apps/api/src/**/{routes,store}.ts` with numeric ids (23 route files use `t.Numeric()`), `apps/api/src/shared/*`, `apps/api/src/mcp/*`, `apps/worker/src/**`, `apps/bot/src/**`, `packages/agent-tools/src/**`, and their `__tests__`.

**Produces:** store functions take and return ids as `string`. `IssueRow.priority: number`, `NewIssueInput.priority?: number`, `IssuePatch.priority?: number`. Analytics `PRIORITY_LABEL` keyed by `0..4` with the same labels (`0: 'No priority', 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low'`). Issue sorting by priority orders 1,2,3,4,0 (Linear's `prioritySortOrder`).

- [ ] **Step 1:** Add a shared `t` schema `uuidParam = t.String({ format: 'uuid' })` in `apps/api/src/shared/lib.ts`; replace every `t.Numeric()` id param and every `t.Number()` id body/query field with it. REST priority field becomes `t.Integer({ minimum: 0, maximum: 4 })`.
- [ ] **Step 2:** Update store signatures/DTOs (`number` → `string` for ids); remove `Number(...)` conversions of ids.
- [ ] **Step 3:** Update tests that build ids or priorities (`'urgent'` → `1`, etc.). Add to `apps/api/src/issues/__tests__/integration/issues.test.ts`: `GET /issues/not-a-uuid` → status 400 (Review Focus); `POST` issue with `priority: 5` → 400.
- [ ] **Step 4:** `bun run typecheck` for api/worker/bot/agent-tools and `bun run test`. Expected: all pass (except Task 0's recorded pre-existing failures).

Proposed commit: `refactor!: switch api, worker and bot to uuid ids and integer priority`

### Task 3: Web follows UUID ids and integer priority

**Files:** `apps/web/src/lib/api.ts` (165 numeric id fields), `apps/web/src/features/**` components that parse or compare ids or priorities (e.g. `features/issue/components/shared/IssueIcons.tsx` `PRIORITY_BARS`).

- [ ] **Step 1:** Change id types to `string`; remove `Number()`/`parseInt` of ids from routes/params.
- [ ] **Step 2:** Priority UI uses `0..4`: `PRIORITY_BARS = { 4: 1, 3: 2, 2: 3 }`, urgent = 1, none = 0. Priority pickers, filters and sort use the integers.
- [ ] **Step 3:** `bun run typecheck && bun run lint && bun run build`. Expected: pass.
- [ ] **Step 4:** Run the app (`bun run dev`), sign up, create a project and an issue, set priority, move it across columns. Expected: works; URLs use project key + identifier as before.

Proposed commit: `refactor(web)!: use uuid ids and integer priority`

### Task 4: Issue store — parent, estimate, creator, status timestamps

**Files:** Modify `apps/api/src/issues/store.ts`, `apps/api/src/issues/routes.ts`; Test `apps/api/src/issues/__tests__/integration/issues.test.ts`.

**Produces:** `IssueRow` gains `parentId: string | null`, `estimate: number | null`, `creatorUserId: string | null`, `startedAt`, `completedAt`, `canceledAt: string | null`. `NewIssueInput`/`IssuePatch` gain `parentId?: string | null`, `estimate?: number | null`. `createIssue` sets `creatorUserId = actorUserId`. Pure function `nextStatusTimestamps(prev: {startedAt, completedAt, canceledAt}, toType: StateType, now: Date)` in `apps/api/src/issues/status-timestamps.ts`.

- [ ] **Step 1: Unit tests** in `apps/api/src/issues/__tests__/unit/status-timestamps.test.ts`:
  - `started` from null sets `startedAt = now`; `started` with existing `startedAt` keeps it.
  - `completed` sets `completedAt`, keeps `startedAt`; then `started` clears `completedAt`.
  - `canceled` sets `canceledAt`; leaving to `completed` clears `canceledAt`, sets `completedAt`.
  - `backlog`/`unstarted` clears all three.
- [ ] **Step 2:** Implement; apply it in `createIssue` and in `updateIssue` when `columnId` changes.
- [ ] **Step 3: Integration tests:** create in a started column → `startedAt` set; move to completed → `completedAt` set; move to backlog → all null. `parentId` from another project → 400. `parentId` = self → 400; `parentId` = own child → 400 (Review Focus). `estimate: 3` round-trips. `creatorUserId` = creating user.
- [ ] **Step 4:** Parent validation `assertParent(projectId, issueId | null, parentId)` walks ancestors with a recursive CTE and rejects a cycle.
- [ ] **Step 5:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): add parent, estimate, creator and status timestamps to issues`

### Task 5: Column description and archive

**Files:** Modify `apps/api/src/columns/{store,routes}.ts`, `apps/api/src/issues/store.ts` (`assertColumn`); Test `apps/api/src/columns/__tests__/integration/columns.test.ts`.

**Produces:** `ColumnRow` gains `description: string`, `archivedAt: string | null`. `listColumns(projectId, { includeArchived = false } = {})`. `archiveColumn(id: string): Promise<ColumnRow>` throws `HttpError(409)` while non-archived issues are in it and `HttpError(409)` when it is the last non-archived column of its type. REST: `POST /columns/:columnId/archive` (permission `states.edit`), `description` accepted on create/update.

- [ ] **Step 1: Tests:** archive empty non-last column → 200, gone from `GET /projects/:key/columns`; archive with an issue → 409; archive last `completed` column → 409; create/move an issue into an archived column → 400; non-member → 403.
- [ ] **Step 2:** Implement; `assertColumn` rejects archived columns.
- [ ] **Step 3:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): add workflow state description and archive`

### Task 6: GraphQL endpoint skeleton

**Files:**
- Create: `apps/api/src/graphql/schema.graphql` (copied from `github.com/linear/linear` `packages/sdk/src/schema.graphql`), `SCHEMA_SOURCE.md` (commit SHA, date), `apps/api/src/graphql/routes.ts` (Elysia plugin), `context.ts`, `errors.ts`, `schema.ts`, `resolvers/organization.ts`, `resolvers/user.ts` (viewer only here).
- Modify: `apps/api/src/app.ts` (mount outside the planner), `apps/api/package.json` (`graphql`, `graphql-yoga`, `@graphql-tools/schema`; dev `@linear/sdk`), `packages/auth/src/index.ts` if needed for `Authorization` handling.
- Test: `apps/api/src/graphql/__tests__/integration/endpoint.test.ts`, `apps/api/src/graphql/__tests__/unit/sdk-documents.test.ts`, helper `apps/api/src/__tests__/helpers/linear.ts`.

**Produces:**
- `GraphQLContext = { user: SessionUser }` built in `context.ts` by `resolveGraphQLUser(request): Promise<SessionUser | null>`: reads `Authorization` (raw key or `Bearer <key>`), verifies it through better-auth's API key plugin (`auth.api.verifyApiKey`) and loads the owner; otherwise falls back to `auth.api.getSession` (cookie, `x-api-key`).
- `gqlError(code, message): GraphQLError` and `fromHttpError(err): GraphQLError` (400→INVALID_INPUT, 403→FORBIDDEN, 404→ENTITY_NOT_FOUND, 409→CONFLICT) in `errors.ts`.
- `buildSchema(resolvers)` in `schema.ts`: `makeExecutableSchema({ typeDefs, resolvers })`, then wraps every `Query`/`Mutation` field without a resolver so it throws `gqlError('NOT_IMPLEMENTED', '<field> is not implemented')`.
- Organization id is read from `app_setting` key `graphql_organization_id`, created on first read.
- Test helper `linearClient(apiKey): LinearClient` with `apiUrl: 'http://localhost/graphql'` and a custom `fetch` that calls `app.handle`.

- [ ] **Step 1: Tests:**
  - No credentials → HTTP 401, `errors[0].extensions.code === 'AUTHENTICATION_ERROR'`.
  - `linearClient(key).viewer` → `{ id: userId, email }`; same with `Bearer <key>` header via raw fetch.
  - `organization` → stable id across two calls.
  - `{ cycles { nodes { id } } }` → `NOT_IMPLEMENTED`.
  - Unit: every operation in `@linear/sdk`'s generated documents validates against `schema.graphql` with `graphql`'s `validate` (zero errors).
- [ ] **Step 2:** Implement; mount at `/graphql` (POST and GET).
- [ ] **Step 3:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): serve Linear's GraphQL schema at /graphql`

### Task 7: Connections, teams, users, workflow states (queries)

**Files:** Create `apps/api/src/graphql/connection.ts`, `resolvers/team.ts`, `resolvers/workflow-state.ts`; extend `resolvers/user.ts`; Test `apps/api/src/graphql/__tests__/integration/teams-states.test.ts`.

**Produces:**
- `paginate<T>(args: { first?, after?, last?, before?, orderBy? }, query): Promise<Connection<T>>` — keyset on `(createdAt|updatedAt, id)`; cursor = base64url of `"<iso>|<id>"`; `first`/`last` > 250 or < 0 → `INVALID_INPUT`.
- `visibleProjectIds(userId): Promise<string[]>` in `resolvers/team.ts`.
- Queries `teams`, `team(id)` (UUID or key), `Team.states`, `Team.members`, `workflowStates(filter)`, `workflowState(id)`, `users`, `user(id)`, `viewer`. Users visible = viewer ∪ members of the viewer's projects.

- [ ] **Step 1: Tests:** member sees own team, not another; `team(id: 'MKT')` works; non-member `team(id)` → `ENTITY_NOT_FOUND`; `team.states()` returns columns in position order with `type`; archived state only with `includeArchived: true`; `workflowStates(filter: { type: { eq: "started" } })`; `users` excludes a user who shares no project; `workflowStates(first: 251)` → `INVALID_INPUT`, `first: 250` OK; pagination walks 3 pages of 2 states with `after`.
- [ ] **Step 2:** Implement. **Step 3:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): add GraphQL teams, users and workflow states`

### Task 8: Issue queries and field resolvers

**Files:** Create `resolvers/issue.ts`, `apps/api/src/graphql/issue-filter.ts`; Test `apps/api/src/graphql/__tests__/integration/issues-query.test.ts`.

**Produces:**
- `issue(id)`: UUID, or identifier matched case-insensitively on project key. Malformed UUID → `ENTITY_NOT_FOUND`.
- `issues(filter, …)`, `searchIssues(term)`, `Team.issues`, `WorkflowState.issues`, `Issue.children`, `User.assignedIssues` — all scoped to `visibleProjectIds`.
- `issueFilterToSql(filter: IssueFilter): SQL` supporting exactly the fields and comparators listed in the spec; any other key → `INVALID_INPUT` naming it.
- `Issue` resolvers: real fields per the spec's concept mapping; `identifier`, `url` (`${APP_URL}/project/<key>/issue/<identifier>` — match the web route), `branchName` (`<identifier-lowercase>-<slugified-title>`, max 60 chars), `priorityLabel`, `prioritySortOrder` (1..4 → same, 0 → 5); unimplemented fields return the neutral values listed in the spec, and `sharedAccess` a minimal valid object.

- [ ] **Step 1: Tests:** `client.issue(id)` returns the full SDK fragment without errors and `priority`, `state.id`, `team.id`, `parent.id`, `estimate` match REST; `issue('mkt-42')` = `issue('MKT-42')` (Review Focus); `issue('abc')` → `ENTITY_NOT_FOUND` (Review Focus); non-member → `ENTITY_NOT_FOUND`; filters `state.type`, `assignee.isMe`, `priority.lte`, `or`; unknown filter key → `INVALID_INPUT`; archived issue only with `includeArchived`; `searchIssues('login')` finds a title match; `issues(first: 251)` → `INVALID_INPUT`, `first: 250` OK (Review Focus).
- [ ] **Step 2:** Implement. **Step 3:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): add GraphQL issue queries`

### Task 9: Mutations

**Files:** extend `resolvers/issue.ts`, `resolvers/workflow-state.ts`; Test `apps/api/src/graphql/__tests__/integration/mutations.test.ts`.

**Produces:** `issueCreate`, `issueUpdate`, `issueArchive`, `issueUnarchive`, `issueDelete`, `issueBatchUpdate`, `workflowStateCreate`, `workflowStateUpdate`, `workflowStateArchive`, each calling the store function and checking the REST permission (`work_items.create/edit/delete`, `states.create/edit`) with `assertPermission`. Payload `{ success: true, lastSyncId, issue | workflowState }`; `lastSyncId` = `Date.now()` (a number that increases; ids are UUIDs, so no row id can serve). Unimplemented input fields present in the input → `INVALID_INPUT` naming them.

- [ ] **Step 1: Tests:**
  - `client.createIssue({ teamId, title })` → default state matches REST's default; `identifier` = `KEY-n`.
  - `updateIssue` with `stateId` → `completedAt` set; REST `GET /issues/:id/timeline` shows the same activity entry REST would write; one webhook delivery row of `issue.state_changed` (read via the webhooks REST route).
  - `stateId` from another team → `INVALID_INPUT` (Review Focus).
  - `labelIds` in input → `INVALID_INPUT` naming `labelIds`.
  - member without `work_items.edit` → `FORBIDDEN`.
  - `issueBatchUpdate` with one forbidden id → `FORBIDDEN` and no issue changed.
  - `archiveIssue` / `unarchiveIssue` round-trip; `deleteIssue` then `issue(id)` → `ENTITY_NOT_FOUND`.
  - `workflowStateCreate({ teamId, name, type: 'started', color })`; `type: 'triage'` → `INVALID_INPUT`; `workflowStateArchive` rules from Task 5 surface as `CONFLICT`.
- [ ] **Step 2:** Implement. **Step 3:** `bun run test`. Expected: pass.

Proposed commit: `feat(api): add GraphQL issue and workflow state mutations`

### Task 10: Finish

- [ ] `bun run format && bun run format:check && bun run lint && bun run typecheck && bun run build && bun run test`. Expected: all pass.
- [ ] Update `apps/api/AGENTS.md` (GraphQL section: layout, auth header, NOT_IMPLEMENTED rule, how to update the vendored schema) and `README.md` feature list (Linear-compatible GraphQL API).
- [ ] Run the `tidy` skill, then `code-review`, per `AGENTS.md`.

# Linear-format Webhooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Outgoing webhooks that a Linear webhook receiver accepts unchanged, with Linear's subscription model, delivery rules and GraphQL management.

**Architecture:** The API builds the complete Linear payload when a change happens and queues it in the existing `webhook_delivery` outbox, one row per matching webhook. Entity `data` comes from the GraphQL mappers. The worker keeps claim, lease, cleanup and auto-disable, and changes headers, signature, success rule and retry schedule.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests, Next.js web.

**Spec:** `docs/superpowers/specs/2026-11-21-linear-webhooks-design.md`

## Global Constraints

- Resource types: exactly `Issue`, `Comment`, `IssueLabel`, `Project`, `ProjectUpdate`. Any other type in an input → 400 / INVALID_INPUT naming it.
- Headers: `Content-Type: application/json; charset=utf-8`, `User-Agent: Linear-Webhook`, `Linear-Delivery` (event id), `Linear-Event` (resource type), `Linear-Timestamp` (send time, Unix ms), `Linear-Signature` (hex HMAC-SHA256 of the raw body, keyed with the webhook secret).
- Envelope keys: `action` (`create` | `update` | `remove`), `type`, `actor`, `createdAt`, `data`, `updatedFrom` (update only), `url`, `organizationId`, `webhookTimestamp`, `webhookId`.
- Delivery: timeout 5000 ms; success is HTTP 200 only; 3 retries after 60 s, 3600 s, 21600 s; then `failed`.
- All-teams webhooks: managed only by the god user or by a user who is owner of every team, checked on every operation.
- No `X-Itsaplan-*` header, granular event name (`issue.state_changed` …) or timestamped signature remains anywhere.
- Baseline migration regenerated (`packages/db/drizzle/0000_*.sql`); no data to keep. Keep the storage seed and the six `project_status` inserts appended to it, as in stage 2.
- Commit after each task, no trailer (user instruction).

## Review Focus

1. A team webhook never receives an event of a team it does not cover — including a project in teams A and B delivered to A's webhook only through A, and an issue moved between projects. Test in Task 4.
2. A delivery retried after an hour still passes a receiver's one-minute `webhookTimestamp` check, and the signature covers the body as sent (with the refreshed timestamp). Test in Task 6.
3. A user who owned every team and then lost ownership of one cannot read, edit or delete an all-teams webhook; a later-created team's events reach existing all-teams webhooks. Tests in Task 1 and Task 2.
4. `updatedFrom` on an issue whose labels change holds the previous `labelIds` (sorted) and `updatedAt`, and nothing that did not change. Test in Task 2.
5. Bulk updates and the auto-archive sweep send one event per issue with the right actor (`null` for the sweep). Tests in Task 2 and Task 5.

---

### Task 1: Subscription model, access and REST management

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`webhook` table), regenerate `packages/db/drizzle/0000_*.sql`
- Modify: `apps/api/src/webhooks/store.ts`, `apps/api/src/webhooks/routes.ts`, `apps/api/src/analytics/store.ts` (uses `webhook.isActive`), `apps/worker/src/store.ts` (`is_active` → `enabled`)
- Create: `apps/api/src/webhooks/access.ts`
- Test: `apps/api/src/webhooks/__tests__/integration/webhooks.test.ts` (rewrite for the new fields)

**Interfaces:**
- Produces:
  - `WEBHOOK_RESOURCE_TYPES = ['Issue','Comment','IssueLabel','Project','ProjectUpdate'] as const`, `type WebhookResourceType` (store.ts).
  - `WebhookRow { id; teamId: string | null; allPublicTeams: boolean; url; label: string | null; secret; resourceTypes: WebhookResourceType[]; enabled: boolean; creatorUserId: string | null; createdAt; updatedAt }`.
  - `listWebhooks(teamId: string)`, `listAllTeamsWebhooks()`, `createWebhook(input: { teamId: string | null; allPublicTeams: boolean; url; label?; secret?; resourceTypes; enabled?; creatorUserId })` (generates a secret when none given), `getWebhook(id)`, `updateWebhook(id, patch: { url?; label?; resourceTypes?; enabled?; secret? })`, `rotateWebhookSecret(id): Promise<WebhookRow>`, `deleteWebhook(id)`, `listWebhookDeliveries` (unchanged).
  - `canManageAllTeams(user: { id: string; role: string }): Promise<boolean>` and `assertAllTeamsManager(user)` (403) in `webhooks/access.ts`: true for `role === 'god'`, or when the user's `team_member` rows with role `owner` cover every row of `team` (and at least one team exists).
- Schema: `team_id` nullable; `all_public_teams boolean not null default false`; `label text`; `resource_types jsonb not null default '[]'`; `enabled boolean not null default true` (replaces `is_active`); `creator_user_id` FK user `on delete set null`; `updated_at`; check `(team_id IS NOT NULL) <> all_public_teams`; drop `events`.

- [ ] **Step 1: Write the failing tests** (Eden Treaty, `resetDb` per test):
  - `creates a team webhook with resource types and a label`: POST `/teams/MKT/webhooks {url, resourceTypes:['Issue','Project'], label:'CI'}` → 201, body `toMatchObject({teamId, allPublicTeams:false, resourceTypes:['Issue','Project'], label:'CI', enabled:true})`, `secret` length ≥ 32.
  - `rejects an unknown resource type`: `resourceTypes:['Cycle']` → 400.
  - `the god user creates an all-teams webhook`: POST `/webhooks {url, resourceTypes:['Issue']}` → 201 `{teamId:null, allPublicTeams:true}`; GET `/webhooks` lists it.
  - `an owner of every team manages all-teams webhooks`: second user (not god) creates teams MKT and OPS → POST `/webhooks` 201.
  - `an owner of some teams cannot`: that user is only a member of OPS → POST `/webhooks` 403, GET `/webhooks` 403, PATCH/DELETE `/webhooks/:id` of an all-teams webhook 403.
  - `losing ownership of one team removes access`: owner of all creates the webhook; a new team appears that they do not own → PATCH `/webhooks/:id` 403.
  - `rotates the secret`: POST `/webhooks/:id/rotate-secret` → new secret differs from the old one.
  - Keep the existing URL-validation and deliveries tests, adjusted to the new fields.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/webhooks` — Expected: FAIL (unknown fields / routes).
- [ ] **Step 3: Implement** the schema, `bun run db:generate` after deleting the old baseline, re-append the storage seed and project status inserts, `bun run db:migrate:test`; store and access functions above; routes:
  - team routes keep `webhooks.<action>` permission; bodies use `resourceTypes`, `label`, `enabled`.
  - `GET /webhooks`, `POST /webhooks` (workspace level, body without `teamId`, guarded by `assertAllTeamsManager` through a local macro `allTeamsManager: true`).
  - `/webhooks/:webhookId` (GET/PATCH/DELETE, deliveries, new `POST …/rotate-secret`): a team webhook resolves access through its team as today; an all-teams webhook through `assertAllTeamsManager`.
  - Temporarily map the existing `emitWebhookEvent(teamId, eventType, data)` matching from `events @>` to `resource_types @>` with the event's resource type (`issue.*` → `Issue`, `comment.created` → `Comment`) so current emit points keep working until Task 2 replaces them.
- [ ] **Step 4: Run** the same tests — Expected: PASS. Run `bun run typecheck` at the root — Expected: 0 errors (web types follow in Task 8; keep `apps/web` compiling by updating `lib/api.ts` `Webhook` fields now).
- [ ] **Step 5: Commit** `feat(api): add Linear webhook subscriptions`

### Task 2: Event builder and Issue events

**Files:**
- Create: `apps/api/src/webhooks/event.ts` (envelope, fan-out, diff), `apps/api/src/webhooks/data.ts` (entity data builders)
- Modify: `apps/api/src/issues/store.ts` (create, update, setIssueLabels, archive, restore, delete, bulk functions)
- Test: `apps/api/src/webhooks/__tests__/integration/issue-events.test.ts`, `apps/api/src/webhooks/__tests__/unit/updated-from.test.ts`

**Interfaces:**
- Produces (`event.ts`):
  - `type WebhookAction = 'create' | 'update' | 'remove'`
  - `emitEvent(input: { type: WebhookResourceType; action: WebhookAction; teamIds: string[]; actorUserId: string | null; data: Record<string, unknown>; before?: Record<string, unknown> }): Promise<void>` — selects enabled webhooks whose `resource_types` contain `type` and that are all-teams or whose `team_id` is in `teamIds`, one row per webhook (dedupe); no-op when none or when `action === 'update'` and `updatedFrom` is empty apart from `updatedAt`. Payload stored: `{ action, type, actor, createdAt, data, updatedFrom?, url: data.url, organizationId, webhookId }` (no `webhookTimestamp`; the worker adds it). `event_type` = `type`.
  - `updatedFrom(before, after): Record<string, unknown>` — keys of `after` whose JSON value differs from `before`'s, mapped to the `before` value (`undefined` → `null`), plus `updatedAt: before.updatedAt`; nested objects (`team`, `state`, `assignee`, `labels`) are excluded from the diff (their ids are covered by `teamId`, `stateId`, `assigneeId`, `labelIds`).
  - `actor`: `{ id, type: 'user', name, email }` from the user row (no `url`: the web app has no user page), `null` when `actorUserId` is null or the user is gone. `organizationId` from `getOrganization().id` (`graphql/resolvers/organization.ts`).
- Produces (`data.ts`): `issueData(issueId: string): Promise<Record<string, unknown> | null>` — `issueById(id)` output (`resolvers/issue.ts`) with Linear's webhook keys added: `teamId`, `stateId`, `assigneeId` (from `assigneeUserId`), `creatorId`, `parentId`, `projectId`, `projectMilestoneId`, `labelIds` (sorted), `team {id,key,name}`, `state {id,name,color,type}`, `assignee {id,name,email} | null`, `labels [{id,name,color}]`; the internal `*UserId` keys removed.
- Consumes: Task 1 `WebhookResourceType`.

- [ ] **Step 1: Write the failing tests.** Unit `updated-from.test.ts`: `updatedFrom({title:'a',labelIds:['1'],updatedAt:'t0',state:{id:'s'}}, {title:'b',labelIds:['1'],updatedAt:'t1',state:{id:'x'}})` → `{title:'a', updatedAt:'t0'}`; unset previous value → `null`. Integration (read payloads through `GET /webhooks/:id/deliveries`; owner creates a team webhook with `resourceTypes:['Issue']`):
  - `issue create sends Issue create with data and actor`: payload `toMatchObject({action:'create', type:'Issue', data:{id, identifier:'MKT-1', teamId, stateId, labelIds:[]}, actor:{id: owner.userId, type:'user'}, organizationId: <string>, webhookId})`; no `updatedFrom`; `eventType === 'Issue'`.
  - `state change sends updatedFrom with the old stateId`: PATCH the issue's `stateId` → `updatedFrom` equals `{stateId: <old>, updatedAt: <old updatedAt>}` plus any field the store also changes (e.g. `startedAt`), never `title`.
  - `label change sends labelIds in updatedFrom` (Review Focus 4): previous `labelIds` sorted.
  - `archive and restore send Issue update with archivedAt in updatedFrom`.
  - `delete sends Issue remove with the data before deletion`.
  - `bulk update sends one event per issue` (Review Focus 5): three issues → three deliveries, distinct `data.id`.
  - `an all-teams webhook receives events of a team created after it` (Review Focus 3).
  - `a disabled webhook or one without Issue receives nothing`.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/webhooks` — Expected: FAIL.
- [ ] **Step 3: Implement** `event.ts`, `data.ts`; in `issues/store.ts` read `issueData` before each write that changes an existing issue and after it, call `emitEvent`; remove every `emitWebhookEvent` call for issues and the granular events. `comment.created` stays on `emitWebhookEvent` (Task 1 mapping) until Task 3.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): send Linear-format issue webhooks`

### Task 3: Comment and IssueLabel events

**Files:**
- Create: `apps/api/src/graphql/resolvers/comment.ts` (`toComment`), `apps/api/src/graphql/resolvers/issue-label.ts` (`toIssueLabel`, `toLabelGroupAsIssueLabel`)
- Modify: `apps/api/src/webhooks/data.ts`, `apps/api/src/issues/activity.ts` (`createComment`), `apps/api/src/labels/store.ts` and its route callers (add `actorUserId: string | null` to create/update/delete of labels and groups)
- Test: `apps/api/src/webhooks/__tests__/integration/comment-label-events.test.ts`

**Interfaces:**
- Produces: `toComment(row: typeof issueActivity.$inferSelect & { kind: 'comment' })` → Linear `Comment` fields `{ id, body, createdAt, updatedAt, archivedAt: null, editedAt: null, issueId, userId: actorUserId, url: <issue url>#comment-<id> }`. `toIssueLabel(row: typeof label.$inferSelect)` → `{ id, name, color, description: null, isGroup: false, parentId: groupId, teamId, createdAt, updatedAt, archivedAt: null }`; `toLabelGroupAsIssueLabel(row: typeof labelGroup.$inferSelect)` → same shape with `isGroup: true, parentId: null`. `commentData(id)`, `issueLabelData(id)`, `labelGroupData(id)` in `data.ts`.
- Consumes: Task 2 `emitEvent`.

- [ ] **Step 1: Write the failing tests** (webhook with `['Comment','IssueLabel']`):
  - `comment create sends Comment create`: `data` `toMatchObject({id, body:'hi', issueId, userId: owner.userId})`.
  - `label create, rename and delete send IssueLabel create/update/remove`; rename's `updatedFrom` holds the old `name`.
  - `a label group is an IssueLabel with isGroup`: creating a group → `data.isGroup === true`; a label in it has `parentId === group.id`.
  - `deleting a group sends update for each label it held`: two labels → two IssueLabel `update` deliveries with `updatedFrom.parentId === group.id`, plus the group's `remove`.
  - `an issue label change does not send IssueLabel events` (it is an Issue update).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; delete `apps/api/src/webhooks/emit.ts` (its last caller was `createComment`).
- [ ] **Step 4: Run** `bun test --env-file=../../.env.test src/webhooks src/labels src/issues` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): send comment and label webhooks`

### Task 4: Project and ProjectUpdate events

**Files:**
- Modify: `apps/api/src/projects/store.ts` (`createProject`, `updateProject`, `setProjectTeams`, `setProjectArchived`, `deleteProject`), `apps/api/src/projects/updates.ts` (`createUpdate`, `updateUpdate`, `deleteUpdate`), their REST routes, `graphql/resolvers/project-mutations.ts`, `apps/api/src/webhooks/data.ts`
- Test: `apps/api/src/webhooks/__tests__/integration/project-events.test.ts`

**Interfaces:**
- Produces: `projectData(id): Promise<Record<string, unknown> | null>` — `toProject(await getProject(id))` (all teams, no visibility filter) plus `teamIds` (sorted), `statusId`, `leadId`, `labelIds`. `projectUpdateData(id)` — `toUpdate(row)` plus `projectId`, `userId`.
- `setProjectTeams`, `setProjectArchived`, `deleteProject`, `updateUpdate`, `deleteUpdate` gain a trailing `actorUserId: string | null` parameter; every caller passes the acting user.
- Fan-out teams: create → project's teams; update → union of teams before and after; remove → teams before deletion; ProjectUpdate → the project's current teams.

- [ ] **Step 1: Write the failing tests** (teams MKT and OPS; webhook A on MKT, B on OPS, C on a third team ENG, each `['Project','ProjectUpdate']`):
  - `a project in MKT and OPS sends one create to A and one to B, none to C` (Review Focus 1).
  - `an all-teams webhook gets one delivery for a two-team project`.
  - `removing OPS from the project sends the update to A and B`: B's payload `updatedFrom.teamIds` = `[mkt, ops]` sorted, `data.teamIds` = `[mkt]`.
  - `a later update after the removal reaches A only`.
  - `delete sends Project remove to the teams it had`.
  - `posting an update sends ProjectUpdate create with health`: `data` `toMatchObject({projectId, health:'atRisk', userId})`; edit → `update` with `updatedFrom.body`; delete → `remove`.
  - `archive sends Project update with archivedAt`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test --env-file=../../.env.test src/webhooks src/projects src/graphql` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): send project webhooks`

### Task 5: Auto-archive events from the worker

**Files:**
- Create: `apps/api/src/webhooks/internal-routes.ts` (registered next to the other internal routes in `app.ts`)
- Modify: `apps/worker/src/worker.ts`, `apps/worker/src/internal-api.ts` (add `notifyIssuesArchived`)
- Test: `apps/api/src/webhooks/__tests__/integration/internal-routes.test.ts`

**Interfaces:**
- Produces: `POST /internal/webhooks/issues-archived { issueIds: string[] }`, `x-worker-token` checked like `ai-agents/internal-routes.ts`; for each id sends an Issue `update` with `actor: null` and `updatedFrom: { archivedAt: null, updatedAt }`. Worker: `notifyIssuesArchived(ids: string[])` via `postInternal`, called after `archiveStaleIssues()` in the same try/catch style as `deleteIssueAgentThreads` (an unreachable API logs and does not fail the tick).

- [ ] **Step 1: Write the failing tests:**
  - `archived issues report sends Issue update with a null actor` (Review Focus 5): with `WORKER_INTERNAL_TOKEN` set, archive an issue through the store directly (same SQL effect as the sweep), POST the route with the token → delivery `toMatchObject({action:'update', actor:null, updatedFrom:{archivedAt:null}})`.
  - `rejects a missing worker token` → 401.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Confirm with `grep -n "UPDATE\|INSERT\|DELETE" apps/worker/src/*.ts` that no other worker job writes issues, comments, labels or projects; ledger the result.
- [ ] **Step 4: Run** the test — Expected: PASS. `bun run typecheck` — 0 errors.
- [ ] **Step 5: Commit** `feat(worker): report auto-archived issues for webhooks`

### Task 6: Worker delivery format and retry schedule

**Files:**
- Modify: `apps/worker/src/delivery.ts`, `apps/worker/src/signature.ts`, `apps/worker/src/config.ts`, `apps/worker/src/store.ts` (`scheduleRetry`, `markFailed`), `apps/worker/src/worker.ts`
- Delete: `apps/worker/src/backoff.ts` and its test if nothing else uses it (check `notification-delivery.ts` first; keep it if used)
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml` (drop `WEBHOOK_MAX_ATTEMPTS`; `WEBHOOK_TIMEOUT_MS` default 5000)
- Test: `apps/worker/src/__tests__/unit/signature.test.ts`, create `apps/worker/src/__tests__/unit/delivery.test.ts`

**Interfaces:**
- Produces: `signBody(secret: string, body: string): string` (hex HMAC-SHA256); `WEBHOOK_RETRY_DELAYS_S = [60, 3600, 21600]`; `renderBody(payload: object, now: number): string` = `JSON.stringify({ ...payload, webhookTimestamp: now })`; `deliver(input)` sends the headers in Global Constraints, treats only 200 as success.

- [ ] **Step 1: Write the failing tests** (unit, local `Bun.serve` receiver):
  - `signature is the hex HMAC of the raw body`: equals `createHmac('sha256', s).update(body).digest('hex')`.
  - `a Linear-style receiver accepts the delivery` (Review Focus 2): the receiver recomputes the HMAC over the raw request bytes, compares with `timingSafeEqual` to `Linear-Signature`, checks `Math.abs(Date.now() - body.webhookTimestamp) <= 60000`, and checks `Linear-Event`, `Linear-Delivery`, `Linear-Timestamp`, `User-Agent: Linear-Webhook` → returns 200; `deliver` → `ok: true`.
  - `a retried payload gets a fresh webhookTimestamp`: `renderBody(p, t1)` vs `renderBody(p, t2)` differ only in `webhookTimestamp`.
  - `201 counts as a failure`, `a 6 s response times out at 5 s`.
  - `retry delays are 60, 3600, 21600 and the fourth failure is final` (pure function `nextRetryDelayS(attempts: number): number | null`).
- [ ] **Step 2: Run** `cd apps/worker && bun test src/__tests__/unit` — Expected: FAIL.
- [ ] **Step 3: Implement**; `markFailed` when `nextRetryDelayS` returns null; non-200 responses are retried like timeouts (Linear does not distinguish).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): deliver webhooks in Linear's format`

### Task 7: GraphQL webhook management

**Files:**
- Create: `apps/api/src/graphql/resolvers/webhook.ts`; register in `mount.ts`
- Test: `apps/api/src/graphql/__tests__/integration/webhooks.test.ts`

**Interfaces:**
- Produces: Query `webhooks` (connection over team webhooks the viewer has `webhooks.read` on, plus all-teams webhooks when `canManageAllTeams`), `webhook(id)` (ENTITY_NOT_FOUND when not visible), `Team.webhooks`; Mutation `webhookCreate(input)` (`url`, `resourceTypes`, `teamId` | `allPublicTeams`, `label`, `secret`, `enabled`, `id` → INVALID_INPUT for `id`), `webhookUpdate(id, input)`, `webhookDelete(id)` (`DeletePayload`), `webhookRotateSecret(id)` (check the SDL for its payload type). `Webhook` fields: `id, url, label, enabled, secret, resourceTypes, team, allPublicTeams, creator, createdAt, updatedAt, archivedAt: null, failures` (last 50 failed deliveries mapped to `WebhookFailureEvent` fields the SDL defines; unknown fields neutral).
- Consumes: Task 1 store and access functions.

- [ ] **Step 1: Write the failing tests** (SDK `LinearClient`):
  - `createWebhook({ url, teamId, resourceTypes:['Issue'] })` → `webhook.resourceTypes` equals `['Issue']`, `team.id === teamId`.
  - `createWebhook({ url, allPublicTeams:true, resourceTypes:['Project'] })` as god → ok; as an owner of some teams → `FORBIDDEN`.
  - `webhookCreate` with `resourceTypes:['Cycle']` → `INVALID_INPUT` naming `Cycle`; with neither `teamId` nor `allPublicTeams` → `INVALID_INPUT`.
  - `updateWebhook(id, { enabled:false, label:'x' })`, `deleteWebhook(id)`, `rotateSecret` changes the secret.
  - `webhooks()` for a member without `webhooks.read` excludes that team's webhooks.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, reusing `guard`/`onlySupported`/`lastSyncId` from `mutations.ts`.
- [ ] **Step 4: Run** `bun test --env-file=../../.env.test src/graphql` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): manage webhooks over GraphQL`

### Task 8: Web settings

**Files:**
- Modify: `apps/web/src/lib/api.ts` (`Webhook`, `WEBHOOK_RESOURCE_TYPES`), `apps/web/src/services/webhooks.service.ts`, `apps/web/src/features/settings/components/webhooks/*` (dialog, row, table)

**Interfaces:**
- The dialog: resource-type checkboxes (labels: Issues, Comments, Issue labels, Projects, Project updates), a label field, an "All teams" switch shown only when `GET /webhooks` answers 200 (query `useAllTeamsWebhooksQuery`, 403 → hidden, no retry). The list shows all-teams webhooks with an "All teams" badge after the team's own when the query succeeded. Rotate-secret action in the row menu. Deliveries sheet unchanged apart from `eventType` now showing the resource type.

- [ ] **Step 1:** Implement. The web app has no test suite: verify with `bun run typecheck`, `bun run lint`, `bun run build` (0 errors) and by running the app (`bun run dev`) and creating, editing and deleting a team webhook and an all-teams webhook as the god user.
- [ ] **Step 2: Commit** `feat(web): manage Linear-format webhooks`

### Task 9: Finish

- [ ] Update `apps/worker/AGENTS.md` (delivery section: headers, signature, retry schedule, env vars), `apps/api/AGENTS.md` (webhooks: resource types, scope rule, `emitEvent` is called from the stores), README webhook line.
- [ ] Run from the root: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run build`, the API suite (only S3-dependent tests may fail), the worker unit tests.
- [ ] tidy skill, then a fresh whole-branch review on the most capable model with this plan's Review Focus; fix Critical/Important findings test-first.
- [ ] Commit `docs: describe Linear-format webhooks`.

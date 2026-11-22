# GraphQL Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every web page can be served by `/graphql` (plus the small plain-HTTP list), and the web features Linear lacks are gone.

**Architecture:** Five tasks: removals first (so later tasks don't port dead features), then history, views, uploads and settings mappings, each adding Linear's resolvers over the existing stores and keeping the REST pages working until project 5.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's SDL, S3-compatible store, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-22-graphql-gaps-design.md`

## Global Constraints

- Linear's SDL is never edited; unsupported inputs are INVALID_INPUT naming the field.
- The web keeps working on REST after every task (REST routes adapt to the new shapes where a page depends on them).
- Plain HTTP that stays: `/auth-config`, the running version, the upload `PUT`, public raw downloads, better-auth.
- Access follows project 2 (visibility, team managers, roles) and project 3 (organization settings).
- Incremental migrations; never regenerate the baseline. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. An upload URL reused, used by another user, used after expiry, or with a different content type or a larger body is refused. Test in Task 4.
2. `userUpdate({ avatarUrl })` with an SVG, an oversize image, or another user's asset is refused. Test in Task 4.
3. `organizationInviteDetails` with an invite's id (not its token) finds nothing; with the token it returns no private team names. Test in Task 5.
4. `customViewUpdate` / `customViewDelete` on a view of a team the viewer cannot see → ENTITY_NOT_FOUND. Test in Task 3.
5. After a state is renamed, `Issue.history` still resolves `fromState` / `toState` by id. Test in Task 2.

---

### Task 1: Remove the dropped features

**Files:** API, DB and web for: `team_member.description` (route, DTOs, web member text), the webhook delivery-log route (`Webhook.failures` stays; web delivery list goes), view order (`team_view.position`, reorder route, web drag), issue `start_date` (column, inputs, DTOs, filters, web fields) and the board's `statusSince` (and its web display), state type change (`updateState` `stateType`), `team.mcp_enabled` and the per-team projects switch (settings, routes, web toggles, MCP gating moves to API-key access only), the revision-marker routes (board, issue, project, notifications rev; the web refetches its REST queries on an interval instead and gets the unread count from the notifications list), server-stored UI preferences except time zone (theme, issue open mode, start page, stats section, last team, hotkeys → browser `localStorage` with the same defaults; `user_preference` keeps only what remains or is dropped if empty), `computedHealth` (API and web).

- [ ] **Step 1: Write the failing test:** extend `apps/api/src/__tests__/integration/removed-features.test.ts` — the rev routes, the view reorder route, the delivery-log route and member-description route → 404; `PATCH /issues/:id` with `startDate` → 400; `PATCH /teams/:key/states/:id` with `stateType` → 400.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Remove** across API, DB (migration) and web; keep the web building and its pages working.
- [ ] **Step 4: Run** root `format:check`, `lint`, `typecheck`, `build`, full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat!: remove the web features Linear does not have`

### Task 2: History, state history and issue gaps

**Files:** `packages/db` (`issue_activity.from_id`, `to_id`), every activity writer (`issues/activity.ts`, relations, projects), `graphql/resolvers/` (`Issue.history`, `Issue.stateHistory`, `Project.history`), `issue-filter.ts` (`archivedAt`), `issueBatchUpdate` label fields + `issueAddLabel` / `issueRemoveLabel`, `workflowStateUpdate.position`, `teamDelete`.

- [ ] **Step 1: Write the failing tests** `apps/api/src/graphql/__tests__/integration/history.test.ts`:
  - `records typed history` — change state, assignee, priority, title, labels, project → `issue.history` nodes carry `fromState`/`toState` ids, `fromAssignee`/`toAssignee`, `fromPriority`/`toPriority`, `fromTitle`/`toTitle`, `addedLabels`/`removedLabels`, `fromProject`/`toProject`, `actor`.
  - `keeps state ids after a rename` — rename the old state; `fromState.name` is the new name and the id matches.
  - `builds state spans` — create, move twice → `stateHistory` has three spans, the last open (`endedAt` null).
  - `project history` — change a project's status and lead → `project.history` nodes.
  - `filters archived issues` — `issues(filter: { archivedAt: { null: false } }, includeArchived: true)` returns only archived.
  - `batch adds labels` — `issueBatchUpdate(ids, { addedLabelIds })` and `issueAddLabel` / `issueRemoveLabel`.
  - `reorders states` — `workflowStateUpdate(id, { position })` changes the order.
  - `deletes a team` — manager `teamDelete` succeeds; a non-manager → FORBIDDEN.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full suite and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): issue and project history, state history and issue gaps over GraphQL`

### Task 3: Custom views

**Files:** `packages/db` (`team_view.creator_user_id`; migration converting stored web filters to Linear `IssueFilter` in `filter_data`, display into view preferences, creator backfill: team's oldest owner, else oldest member), view-preferences storage, `graphql/resolvers/custom-view.ts`, REST views routes adapted so the web keeps working, web filter-set ↔ `IssueFilter` converter (`apps/web/src/utils/`) used by the REST pages now and GraphQL later.

**Interfaces (Produces):** `filterSetToIssueFilter(set): IssueFilter`, `issueFilterToFilterSet(filter): FilterSet` (web utils).

- [ ] **Step 1: Write the failing tests** `apps/api/src/graphql/__tests__/integration/custom-views.test.ts`:
  - `creates, reads, updates and deletes a team view` — `customViewCreate({ name, teamId, filterData })`, `customViews`, `customView(id)`, `customViewUpdate`, `customViewDelete`; `creator` and `owner` are the viewer.
  - `stores view preferences` — `viewPreferencesCreate` for the view; `customView.viewPreferencesValues` returns them.
  - `hides views of teams the viewer cannot see` — guest of another team → ENTITY_NOT_FOUND on read, update and delete.
  - `rejects a view without a team` — INVALID_INPUT.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate, adapt REST and the web converter.
- [ ] **Step 4: Run** full suite and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: custom views over GraphQL with Linear's filters and view preferences`

### Task 4: File uploads

**Files:** `apps/api/src/uploads/` (signed single-use upload token bound to uploader, content type, size, expiry; plain HTTP `PUT /uploads/:token`; asset URL), `graphql/resolvers/` (`fileUpload`, `attachmentCreate` with an `assetUrl`, `userUpdate({ avatarUrl, timezone })`), `apps/worker` (delete uploads unreferenced after 24 hours), REST attachment and avatar routes kept for the web until project 5.

- [ ] **Step 1: Write the failing tests** `apps/api/src/uploads/__tests__/integration/uploads.test.ts` (object-store tests may need the running store; assert token checks before storage where possible):
  - `uploads through a signed URL` — `fileUpload` → `PUT` → `attachmentCreate({ issueId, url: assetUrl, title })` lists the file on the issue.
  - `refuses a reused, foreign, expired or mismatched upload` — second `PUT`, another user's session, an expired token, a different `Content-Type`, a larger body → refused.
  - `checks the purpose at use` — an oversize attachment for the team quota → refused at `attachmentCreate`; `userUpdate({ avatarUrl })` with an SVG, an oversize image or another user's asset → refused; `avatarUrl: null` clears.
  - `sets the time zone` — `userUpdate({ timezone: 'Europe/Berlin' })`; invalid zone → INVALID_INPUT.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, including the worker cleanup.
- [ ] **Step 4: Run** full suite, worker tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Linear's fileUpload for attachments and avatars`

### Task 5: Settings mappings

**Files:** `teams` (`autoArchivePeriod` replacing the two day thresholds, migration rounding up; auto-archive worker uses it; `autoClosePeriod` read 0, non-zero refused), notification preferences (`userSettings` / `userSettingsUpdate` `notificationCategoryPreferences`; migration: on in any team → on; defaults `assignments`, `mentions`; sending reads them; REST route and web settings page moved to the workspace-wide shape), `organizationInviteDetails(token)` without login (the context allows exactly this operation unauthenticated), `organization.authSettings.approvedDomains`, `Project.progress` / `scope` / history fields, health from the latest update.

- [ ] **Step 1: Write the failing tests** `apps/api/src/graphql/__tests__/integration/settings-mappings.test.ts`:
  - `auto-archive period` — `teamUpdate({ autoArchivePeriod: 3 })` reads back 3; `autoArchivePeriod: 2` → INVALID_INPUT; `autoClosePeriod: 1` → INVALID_INPUT; the sweep archives an issue completed more than 3 months ago only.
  - `notification categories` — defaults email on for assignments and mentions only; `userSettingsUpdate` turns `commentsAndReplies` on; a comment then queues an email.
  - `invite details without a login` — by token → email, role, organization name; by the invite's id → ENTITY_NOT_FOUND; a private team named in the invite is not listed; any other operation without a login → AUTHENTICATION_ERROR.
  - `organization auth settings list approved domains`.
  - `project progress` — three issues, one completed → `progress` ≈ 0.33, `scope` 3.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate, adapt REST and the web settings pages.
- [ ] **Step 4: Run** full suite, worker tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Linear's auto-archive, notification categories, invite details and project progress`

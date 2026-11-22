# Stage 9: Notifications and Issue Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's Notification API over the existing inbox, and Linear's issue subscriptions deciding who is notified.

**Architecture:** A new `issue_subscription` table and `notifications/subscriptions.ts` (subscribe, unsubscribe, list, replace). `notifyComment` / `notifyIssueChange` subscribe automatically and notify subscribers. `notification` gains `archived_at` / `updated_at`; new store functions back GraphQL resolvers in `resolvers/notification.ts`.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-22-linear-graphql-stage9-notifications-design.md`

## Global Constraints

- Incremental migration: `bun run db:generate` makes `0003_*`; the backfill SQL is appended to that file; never regenerate the baseline. Test DB: `bun run db:migrate:test` (reset schemas first only if a run leaves bad rows).
- Backfill subscribers = feed actors of each issue that are members of its team, plus its current assignee if a member.
- Automatic subscription: creator and assignee of a new issue, a new assignee, a comment's author, members mentioned in a comment (create; newly mentioned on edit). Members of the issue's team only. Idempotent.
- `commented` / `state_changed` → subscribers who are members, minus the actor. `assigned` / `mentioned` unchanged.
- Archived notifications: hidden from REST list, unread count, GraphQL list unless `includeArchived`; `notification(id)` returns them. REST delete unchanged.
- GraphQL type map: `assigned`→`issueAssignedToYou`/`assignments`, `mentioned`→`issueCommentMention`/`mentions`, `commented`→`issueNewComment`/`commentsAndReplies`, `state_changed`→`issueStatusChanged`/`statusChanges`; `__typename` `IssueNotification`.
- GraphQL notification reads and writes cover only the viewer's notifications on issues of teams the viewer is a member of.
- `NotificationEntityInput`: `id` or `issueId`; other fields INVALID_INPUT. `NotificationFilter`: `id`, `type`, `createdAt`, `updatedAt`, `archivedAt`, `and`, `or`.
- `subscriberIds`: create = automatic ∪ given; update = replace, then the update's automatic triggers. Non-members → INVALID_INPUT.
- Issue webhook payload `subscriberIds` = current subscribers. No event for subscription-only changes; subscribe/unsubscribe do not bump `issue.updated_at`.
- No web UI changes. Commit after each task, no trailer. Questions are settled the way Linear does.

## Review Focus

1. A user who unsubscribed is re-subscribed (and later notified) after commenting on the issue. Test in Task 1.
2. The actor of a status change who is a subscriber gets no `state_changed`. Test in Task 1.
3. Another user's notification id → ENTITY_NOT_FOUND for `notification`, `notificationUpdate` and `notificationArchive`. Test in Task 2.
4. `issueSubscribe` with a `userId` outside the team → INVALID_INPUT and no row. Test in Task 3.
5. After leaving a team, the user's GraphQL `notifications` list loads without errors and omits that team's notifications. Test in Task 2.

---

### Task 1: Subscriptions table, recipients, archive columns

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`issueSubscription`; `notification.archivedAt`, `notification.updatedAt`), new migration `packages/db/drizzle/0003_*.sql` + backfill
- Create: `apps/api/src/notifications/subscriptions.ts`
- Modify: `apps/api/src/notifications/store.ts` (subscribe in `notifyComment` / `notifyIssueChange`, recipients from subscribers, archived excluded from `listNotifications` / `unreadCount` / `notificationsRev`), `apps/api/src/issues/store.ts` (subscribe the creator in `createIssue`), `apps/api/src/webhooks/data.ts` (`issueData.subscriberIds`)
- Test: `apps/api/src/notifications/__tests__/integration/subscriptions.test.ts`

**Interfaces:**
- `subscribe(issueId: string, userIds: string[]): Promise<void>` (keeps members of the issue's team only; on conflict do nothing)
- `unsubscribe(issueId: string, userId: string): Promise<void>`
- `subscriberIds(issueId: string): Promise<string[]>` (members only, ordered by `created_at`)
- `replaceSubscribers(issueId: string, userIds: string[]): Promise<void>` (callers check membership first)
- `nonMembers(issueId: string, userIds: string[]): Promise<string[]>` (for INVALID_INPUT checks)

- [ ] **Step 1: Write the failing tests** (issues, comments, members via REST; store calls for subscribe):
  - `subscribes the creator and the assignee of a new issue` — create with assignee member → `subscriberIds` contains both.
  - `subscribes a commenter and mentioned members` — member B comments mentioning C → both subscribed.
  - `notifies subscribers of comments and status changes, never the actor` — A creates, B subscribed via `subscribe`; A comments → B gets `commented`; B changes the status → A gets `state_changed`, B gets none.
  - `re-subscribes after unsubscribing and commenting` — `unsubscribe(B)`; A comments → B no notification; B comments; A comments → B gets `commented`.
  - `does not subscribe non-members` — `subscribe(issueId, [outsider])` → not in `subscriberIds`.
  - `hides archived notifications from the REST inbox and unread count` — archive one (store `archiveNotifications`, Task 2 name, or direct update here) → REST list and unread count exclude it.
  - `sends subscriberIds in the Issue webhook` — team webhook `['Issue']`; update issue → payload `data.subscriberIds` equals subscribers.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/notifications` — Expected: FAIL.
- [ ] **Step 3: Implement**, generate the migration, append the backfill, migrate the test DB.
- [ ] **Step 4: Run** — Expected: PASS; typecheck 0 errors; `src/issues src/comments src/webhooks src/graphql` pass.
- [ ] **Step 5: Commit** `feat(api): subscribe users to issues and notify subscribers`

### Task 2: GraphQL notifications

**Files:**
- Create: `apps/api/src/graphql/resolvers/notification.ts`, `apps/api/src/graphql/notification-filter.ts`
- Modify: `apps/api/src/notifications/store.ts` (`getNotification(id)`, `updateNotifications(userId, where, patch)` for read / snooze / archive), `apps/api/src/graphql/mount.ts`
- Test: `apps/api/src/graphql/__tests__/integration/notifications.test.ts`

**Interfaces:**
- Consumes Task 1's columns.
- Notification interface resolution: `Notification.__resolveType` → `'IssueNotification'`.

- [ ] **Step 1: Write the failing tests** (notifications produced through REST comments / assignment; SDK reads; raw `gql` for errors):
  - `lists the viewer's notifications with Linear's types` — B assigned by A → B's `notifications()` has one with `type` `issueAssignedToYou`, `category` `assignments`, `issue.id`, `actor.id` A.
  - `marks read, snoozes and archives` — `updateNotification(id, { readAt })`; `{ snoozedUntilAt }`; `archiveNotification(id)` → hidden from `notifications()`, present with `includeArchived`; `unarchiveNotification` → back.
  - `bulk actions by issue` — two notifications on issue X, one on Y; `notificationMarkReadAll({ issueId: X }, readAt)` → only X's read; `notificationArchiveAll({ id })` archives one.
  - `filters notifications` — `type: { eq: "issueNewComment" }` returns only comment notifications.
  - `hides other users' notifications` — A's id via B: `notification`, `notificationUpdate`, `notificationArchive` → ENTITY_NOT_FOUND.
  - `omits notifications from teams the viewer left` — B removed from the team via REST → B's `notifications` has no errors and no nodes from that team.
  - `rejects unsupported input` — `notificationUpdate(input: { projectUpdateId })` and `notificationArchiveAll(input: { projectId })` → INVALID_INPUT naming the field.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/notifications.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; typecheck 0 errors.
- [ ] **Step 5: Commit** `feat(api): serve notifications over GraphQL`

### Task 3: GraphQL subscriptions, subscriberIds, filter, docs

**Files:**
- Modify: `apps/api/src/graphql/resolvers/notification.ts` or a new `resolvers/issue-subscription.ts` (`Issue.subscribers`, `issueSubscribe`, `issueUnsubscribe`), `apps/api/src/graphql/resolvers/mutations.ts` (`subscriberIds` on `issueCreate` / `issueUpdate`), `apps/api/src/graphql/issue-filter.ts` (`subscribers`: `some`, `every`, `length`, user fields `id`, `name`, `email`, `isMe`), `apps/api/AGENTS.md`, `README.md`, memory `linear-graphql-staged-plan.md`
- Test: `apps/api/src/graphql/__tests__/integration/issue-subscriptions.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `subscribes and unsubscribes over GraphQL` — `issueSubscribe(id)` adds the viewer (`issue.subscribers()`), `issueSubscribe(id, { userId: B })`, `{ userEmail: B's email }`; `issueUnsubscribe(id)` removes the viewer.
  - `rejects a subscriber outside the team` — `issueSubscribe(id, { userId: outsider })` → INVALID_INPUT; subscribers unchanged.
  - `sets subscriberIds on create and replaces them on update` — create with `subscriberIds: [B]` → subscribers {creator, B}; update `subscriberIds: [C]` → {C}; update with a non-member → INVALID_INPUT.
  - `filters issues by subscribers` — `subscribers: { some: { isMe: { eq: true } } }` returns only issues the viewer is subscribed to; `length: { eq: 0 }` the others.
- [ ] **Step 2: Run** the test file — Expected: FAIL.
- [ ] **Step 3: Implement**, then docs.
- [ ] **Step 4: Run** — Expected: PASS; root `format:check`, `lint`, `typecheck`, `build`; full API suite green except S3-only tests.
- [ ] **Step 5: Commit** `feat(api): issue subscriptions over GraphQL`

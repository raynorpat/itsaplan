# Stage 3: Comments, Reactions and Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comments, reactions and labels in Linear's model, served over `/graphql` so `@linear/sdk` and Linear tools work against the instance.

**Architecture:** Comments move from `issue_activity` into a `comment` table; the issue and project feeds merge change-log rows and comments. Labels absorb `label_group` (groups are labels) and gain workspace scope and retirement. A `reaction` table holds emoji reactions. GraphQL resolvers call the same store functions as REST; webhooks follow through `emitEvent`.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests, Next.js web.

**Spec:** `docs/superpowers/specs/2026-11-21-linear-graphql-stage3-comments-labels-design.md`

## Global Constraints

- API-only: no new web features. The web changes only so the feed shows comments from the new table (with an "edited" marker) and issues show workspace labels read-only.
- Comment parent: exactly one of `issue_id`, `project_id`, `project_update_id`. Replies one level: a reply's `parent_id` is a root; a reply to a reply is stored under that reply's root; a reply has its root's parent entity.
- Comment permissions: issue comments — read with team membership, create/reply with `work_items.create`; project / project-update comments — read and create through a team granting `projects.read`; edit — author only; delete — author or an owner of the issue's team (or of one of the project's teams).
- Reactions: add with read access to the item; remove only by the user who added it; one per (item, user, exact emoji); emoji trimmed, 1–64 characters, stored as given.
- Workspace labels (`team_id` null): managed by any member of at least one team (same rule as project labels). Groups cannot be applied or nested; a label's group has the same scope. Retired labels stay on issues, cannot be newly applied.
- Notifications and agent mention runs: issue comments only; an edit notifies and runs only newly mentioned users. Project and project-update comments send webhooks only.
- Baseline migration regenerated whenever the schema changes: save the appended seed block (from `-- Seed the instance upload limits` to the end of `packages/db/drizzle/0000_*.sql`), delete the `.sql` file and the two `meta/` files by name, `rmdir packages/db/drizzle/meta`, `bun run db:generate`, append the seed, reset the `*_test` database schemas, `bun run db:migrate:test`.
- Unsupported GraphQL input fields → INVALID_INPUT naming the field; unimplemented output fields resolve to neutral values.
- Commit after each task, no trailer (user instruction).

## Review Focus

1. A reply whose `parentId` belongs to another issue's (or project's) thread, or names a comment on a different parent than the one given → INVALID_INPUT; resolving a reply (not a root) → INVALID_INPUT. Tests in Task 3.
2. A web label edit on an issue that carries a workspace or retired label keeps it: REST `labelIds` containing a retired label already on the issue succeeds; adding a retired label not on the issue → 400; another team's label → 400. Tests in Task 2.
3. Comments the viewer cannot see never appear: `comments(filter)` and `comment(id)` hide comments on hidden issues and on projects with no `projects.read` team. Tests in Task 3.
4. Editing a comment that adds a mention notifies only the newly mentioned member; an agent mention run's requester is the comment author after the move to `comment`. Tests in Tasks 1 and 3.
5. Deleting a root comment removes its replies; the feed then shows none of them, and feed paging across both tables returns every entry once in `(created_at, id)` order. Tests in Tasks 1 and 3.

---

### Task 1: Move comments into a `comment` table

**Files:**
- Modify: `packages/db/src/schema/app.ts` (new `comment`; `issue_activity` drops `kind` and `body` and its kind check; `notification` gains `source_comment_id` FK comment set null; `agent_run.source_activity_id` → `source_comment_id` FK comment set null), regenerate baseline
- Create: `apps/api/src/comments/store.ts`
- Modify: `apps/api/src/issues/activity.ts` (feed merge, `createComment` moves out), `apps/api/src/issues/routes.ts` (comment route), `apps/api/src/projects/activity.ts`, `apps/api/src/share/store.ts`, `apps/api/src/notifications/store.ts`, `apps/api/src/ai-agents/run-queue.ts`, `apps/worker/src/agent-runs.ts`, `apps/api/src/webhooks/data.ts` (`commentData`), `apps/api/src/graphql/resolvers/comment.ts` (`toComment` reads `comment` rows), `apps/api/src/analytics/store.ts` and any other `issueActivity.kind` reader (find with `grep -rn "kind" ` over `issueActivity` users), `apps/web/src/lib/api.ts` (`FeedItem.editedAt`, `parentId`), the web feed item to show "edited"
- Test: `apps/api/src/comments/__tests__/integration/comments.test.ts`, existing feed / notification / agent-run tests updated

**Interfaces:**
- Produces (`comments/store.ts`):
  - `type CommentParent = { issueId: string } | { projectId: string } | { projectUpdateId: string }`
  - `interface CommentRow { id; issueId: string | null; projectId: string | null; projectUpdateId: string | null; parentId: string | null; userId: string | null; userName: string | null; body: string; editedAt: string | null; resolvedAt: string | null; resolvingUserId: string | null; resolvingCommentId: string | null; createdAt: string; updatedAt: string }`
  - `createComment(input: { parent: CommentParent; parentId?: string | null; body: string; actorUserId: string | null; id?: string }): Promise<CommentRow>` — validates the reply rules (400), stores a reply-to-reply under the root, sends the Comment `create` webhook, and for issue comments runs mention agent runs and `notifyComment`.
  - `getComment(id: string): Promise<CommentRow | null>`
  - `commentTeamIds(comment: CommentRow): Promise<string[]>` — the issue's team, or the project's (or the update's project's) teams.
- Produces (`issues/activity.ts`): `FeedItemRow` gains `editedAt: string | null` and `parentId: string | null` (null for change-log rows); `listFeed`, `listFeedRange` keep their signatures and cursor format and merge both tables.
- Produces: `NewNotificationRow.sourceCommentId: string | null`; `enqueueAgentRun({ ..., sourceCommentId })` replaces `sourceActivityId`.

- [ ] **Step 1: Write the failing tests** in `comments.test.ts` (REST, `resetDb`):
  - `posts a comment that the feed returns with editedAt null and parentId null`: POST `/issues/:id/comments {body:'hi'}` → 201/200 body `toMatchObject({ kind:'comment', body:'hi', editedAt:null, parentId:null })`; GET feed contains it.
  - `merges comments and change-log entries newest first and pages without loss`: create an issue, alternate 3 comments and 3 field changes, page the feed with `limit: 2` → 6 + the `created` entry, each id once, `createdAt` non-increasing.
  - `the range feed includes comments`: `GET /issues/:id/feed/range?from=<created>` lists the comments.
  - `the share page lists comments` (share an issue, read its public bundle).
  - `the project feed lists comments of its issues` (as today).
  - Update existing tests: mention notification (`mentioned` / `commented`) and agent mention run still created; the run's `requesterUserId` is the comment author.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/comments src/issues src/notifications src/ai-agents src/projects src/share` — Expected: FAIL.
- [ ] **Step 3: Implement** the schema (regenerate baseline per Global Constraints), the store, the feed merge (left to the implementer: one `UNION ALL` query ordered by `(created_at, id)` or two keyset queries merged in JS, as long as ordering and cursors match), and every reader/writer listed above. `issueParticipants` also reads comment authors.
- [ ] **Step 4: Run** the same command — Expected: PASS. Run the worker unit tests and `bun run typecheck` at the root — 0 errors.
- [ ] **Step 5: Commit** `feat: store comments in their own table`

### Task 2: Labels in Linear's shape

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`label`: `team_id` nullable, `parent_id` FK label set null, `is_group` bool default false, `description` text null, `retired_at` timestamptz null, `creator_user_id` FK user set null, drop `group_id`; drop `label_group`), regenerate baseline
- Modify: `apps/api/src/labels/store.ts`, `apps/api/src/labels/routes.ts`, `apps/api/src/issues/store.ts` (`assertIssueLabels`, `setIssueLabels`), `apps/api/src/teams/routes.ts` (team detail `labels`, `labelGroups`), `apps/api/src/teams/copy.ts`, `apps/api/src/share/store.ts`, `apps/api/src/graphql/resolvers/issue-label.ts` (one `toIssueLabel`), `apps/api/src/webhooks/data.ts` (drop `labelGroupData`), `apps/worker/src/telemetry*.ts` (label group count), web: `lib/api.ts` (`Label.teamId: string | null`, `retiredAt`), issue label pickers (`IssueProperties`, `NewIssueModal`, filter/effect editors), `utils/publicTeam.ts`
- Test: `apps/api/src/labels/__tests__/integration/labels.test.ts`, `apps/api/src/issues/__tests__/integration/*` label cases

**Interfaces:**
- Produces: REST `LabelRow { id; teamId: string | null; groupId: string | null; name; color; retiredAt: string | null }` (`groupId` is the REST name of `parent_id`); `LabelGroupRow` unchanged, built from `is_group` rows. Team detail `labels` = the team's labels + workspace labels, retired included; `labelGroups` = the team's groups + workspace groups.
- Produces (`labels/store.ts`): `createLabel(input: { teamId: string | null; name; color?; groupId?: string | null; description?: string | null; isGroup?: boolean; actorUserId: string | null }): Promise<LabelRow>`; `updateLabel(id, scopeTeamId: string | null, patch: { name?; color?; groupId?: string | null; description?: string | null }, actorUserId)`; `retireLabel(id, actorUserId)`, `restoreLabel(id, actorUserId)`; `deleteLabel(id, scopeTeamId: string | null, actorUserId)`; the label-group REST functions keep their names and act on `is_group` rows; `assertLabelsApplicable(teamId: string, labelIds: string[], alreadyOnIssue: string[]): Promise<void>` (400 for another team's label, a group, or a retired label not already on the issue).
- IssueLabel webhooks: team label → `[teamId]`; workspace label → `[]` (all-teams webhooks only).
- Web pickers offer `teamId === team.id && !retiredAt` non-group labels; saving keeps every id already on the issue that the picker does not offer.

- [ ] **Step 1: Write the failing tests:**
  - `a group cannot be applied to an issue` → PATCH issue `labelIds:[groupId]` → 400.
  - `a workspace label applies to issues of two teams` (create via the store in the test until Task 5 adds GraphQL; ledger the precondition) → both PATCHes 200, issue DTO `labelIds` contains it.
  - `another team's label cannot be applied` → 400.
  - `a retired label stays on the issue and cannot be newly applied` (Review Focus 2): apply, retire, PATCH with the same set → 200; PATCH another issue adding it → 400.
  - `the team detail lists workspace and retired labels with their flags`.
  - `deleting a group ungroups its labels` (existing test, now on `is_group` rows), IssueLabel webhook tests still pass.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/labels src/issues src/teams src/webhooks` — Expected: FAIL.
- [ ] **Step 3: Implement**; web: typecheck, lint, build.
- [ ] **Step 4: Run** — Expected: PASS; root `bun run typecheck` 0 errors.
- [ ] **Step 5: Commit** `feat: store labels in Linear's shape`

### Task 3: Comments over GraphQL

**Files:**
- Modify: `apps/api/src/comments/store.ts`, `apps/api/src/graphql/resolvers/comment.ts`, `apps/api/src/graphql/mount.ts`, `apps/api/src/notifications/store.ts`, `apps/api/src/issues/activity.ts` (mention runs helper)
- Create: `apps/api/src/graphql/comment-filter.ts`
- Test: `apps/api/src/graphql/__tests__/integration/comments.test.ts`

**Interfaces:**
- Consumes: Task 1 store.
- Produces (`comments/store.ts`): `updateComment(id: string, body: string, actorUserId: string): Promise<CommentRow>` (403 unless author; sets `edited_at`; Comment `update` webhook; notifications and agent runs for mentions not in the old body); `deleteComment(id: string, actorUserId: string): Promise<void>` (403 unless author or owner of one of `commentTeamIds`; Comment `remove` webhook); `resolveComment(id: string, actorUserId: string, resolvingCommentId?: string | null): Promise<CommentRow>` (400 for a reply or a resolving id outside the thread); `unresolveComment(id: string, actorUserId: string): Promise<CommentRow>`; `assertCommentAccess(comment: CommentRow, user, action: 'read' | 'create'): Promise<void>` (404 when not readable).
- GraphQL: `comment(id)`, `comments(filter)` (CommentFilter keys `id`, `body`, `createdAt`, `updatedAt`, `issue`, `project`, `projectUpdate`, `user`, `parent`, `and`, `or`; others INVALID_INPUT), `Issue.comments`, `Project.comments`, `ProjectUpdate.comments`, `Comment.{children, parent, user, issue, project, projectUpdate, resolvingUser, resolvingComment}`; mutations `commentCreate`, `commentUpdate`, `commentDelete` (`DeletePayload`), `commentResolve`, `commentUnresolve` (`CommentPayload`).

- [ ] **Step 1: Write the failing tests** (SDK):
  - `creates a comment on an issue and reads it back` (`client.createComment({ issueId, body })`, `issue.comments()`).
  - `a reply to a reply is stored under the root` → `reply2.parent.id === root.id`; `root.children()` lists both.
  - `rejects a reply whose root is on another issue` (Review Focus 1) → INVALID_INPUT.
  - `only the author edits; editedAt is set` → other member FORBIDDEN.
  - `the author or a team owner deletes; replies go with the root` (Review Focus 5) → feed and `issue.comments()` empty.
  - `resolves a thread with a resolving reply and unresolves it`; `resolving a reply is INVALID_INPUT`.
  - `comments on a project and a project update are visible through projects.read only` (Review Focus 3) → a member without `projects.read` gets ENTITY_NOT_FOUND on `comment(id)` and an empty `comments(filter:{project:{id:{eq}}})`.
  - `comments(filter) hides comments on issues of other teams`.
  - `editing to add a mention notifies only the new member` (Review Focus 4) → inbox of the newly mentioned member has one `mentioned`; the first mentioned member gets nothing new.
  - `project comments send webhooks and no notifications`.
  - Webhooks: Comment `update` (`updatedFrom.body`) and `remove` deliveries.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/graphql src/comments` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): manage comments over GraphQL`

### Task 4: Reactions

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`reaction`: `id`, `comment_id` / `issue_id` / `project_update_id` FK cascade nullable, `user_id` FK user cascade, `emoji` text, `created_at`; check exactly one parent; unique (`coalesce(comment_id, issue_id, project_update_id)`, `user_id`, `emoji`)), regenerate baseline
- Create: `apps/api/src/reactions/store.ts`, `apps/api/src/graphql/resolvers/reaction.ts`
- Modify: `apps/api/src/webhooks/store.ts` (`WEBHOOK_RESOURCE_TYPES` + `Reaction`), `apps/api/src/webhooks/data.ts` (`reactionData`), `apps/web/src/lib/api.ts` (resource type list + label "Reactions")
- Test: `apps/api/src/graphql/__tests__/integration/reactions.test.ts`

**Interfaces:**
- Produces: `createReaction(input: { parent: { commentId: string } | { issueId: string } | { projectUpdateId: string }; emoji: string; userId: string; id?: string }): Promise<ReactionRow>` (409 duplicate → CONFLICT; 400 emoji not 1–64 after trim); `deleteReaction(id: string, userId: string): Promise<void>` (403 unless own); `reactionTeamIds(row): Promise<string[]>`.
- GraphQL: `reactionCreate`, `reactionDelete` (`DeletePayload`); `Issue.reactions`, `ProjectUpdate.reactions`, `Comment.reactions` (`[Reaction!]!`); `reactionData` on the three = `[{ emoji, count, userIds: string[], reactionIds: string[] }]` ordered by first reaction time; `Reaction.{user, comment, issue, projectUpdate}`.
- Webhooks: Reaction `create` / `remove` to the parent's teams.

- [ ] **Step 1: Write the failing tests:** react 👍 to an issue, a comment and a project update; same user + same emoji twice → CONFLICT; another user may react with the same emoji; removing another user's reaction → FORBIDDEN; `reactionData` groups by emoji with counts; a member who cannot see the project cannot react to its update (ENTITY_NOT_FOUND); emoji `"  "` → INVALID_INPUT; Reaction webhook delivered to a webhook subscribed to `Reaction`.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/graphql/__tests__/integration/reactions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** plus `src/webhooks` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): add reactions`

### Task 5: Labels over GraphQL

**Files:**
- Modify: `apps/api/src/graphql/resolvers/issue-label.ts`, `apps/api/src/graphql/resolvers/issue.ts` (`toIssue` gains `labelIds`), `apps/api/src/graphql/resolvers/mutations.ts` (`ISSUE_FIELDS` + `labelIds`, `addedLabelIds`, `removedLabelIds`), `apps/api/src/graphql/mount.ts`
- Create: `apps/api/src/graphql/issue-label-filter.ts`
- Test: `apps/api/src/graphql/__tests__/integration/labels.test.ts`

**Interfaces:**
- Consumes: Task 2 store (`createLabel`, `updateLabel`, `retireLabel`, `restoreLabel`, `deleteLabel`, `assertLabelsApplicable`).
- GraphQL: `issueLabel(id)`, `issueLabels(filter)` (IssueLabelFilter keys `id`, `name`, `isGroup`, `team` incl. `{ null: true }`, `parent`, `createdAt`, `updatedAt`, `and`, `or`), `Team.labels` (team + workspace), `Issue.labels`, `Issue.labelIds`, `IssueLabel.{team, parent, children, creator, issues}`; mutations `issueLabelCreate` (`name`, `color`, `description`, `teamId`, `parentId`, `isGroup`, `id`), `issueLabelUpdate` (`name`, `color`, `description`, `parentId`, `retiredAt` → INVALID_INPUT use retire/restore), `issueLabelDelete`, `issueLabelRetire`, `issueLabelRestore`. Team label writes need the team's `labels.<action>`; workspace label writes need membership in any team.

- [ ] **Step 1: Write the failing tests** (SDK): create a workspace label and a team label; `issueLabels({ filter: { team: { null: true } } })` lists only the workspace one; `team.labels()` lists both; create a group and a child, group cannot be applied (INVALID_INPUT on `createIssue({ labelIds:[group] })`); `updateIssue(id, { addedLabelIds:[ws] })` then `removedLabelIds`; retire → `createIssue` with it INVALID_INPUT, restore → OK; a non-member of any team cannot create a workspace label (FORBIDDEN); IssueLabel webhook for a workspace label reaches an all-teams webhook and not a team webhook.
- [ ] **Step 2: Run** `bun test --env-file=../../.env.test src/graphql/__tests__/integration/labels.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `src/graphql src/labels src/webhooks` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): manage labels over GraphQL`

### Task 6: Finish

- [ ] Update `apps/api/AGENTS.md` (comments table and feed merge, labels model, reactions, GraphQL coverage), the README feature line, and the staged-plan memory.
- [ ] Root: `bun run format:check`, `lint`, `typecheck`, `build`; API suite (only S3-dependent failures); worker unit tests.
- [ ] tidy skill; fresh whole-branch review on the most capable model with this plan's Review Focus; fix Critical/Important findings test-first.
- [ ] Commit `docs: describe comments, reactions and labels`.

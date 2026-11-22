# Stage 5: Initiatives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's initiatives over `/graphql`: initiatives, project links, sub-initiatives, initiative updates with health, comments and reactions on updates, and webhooks.

**Architecture:** Rules are in `apps/api/src/initiatives/` (`access.ts`, `store.ts`, `links.ts`, `updates.ts`). GraphQL resolvers check access with `access.ts` and call the stores; the stores validate business rules and send webhooks. Comments and reactions gain an `initiativeUpdateId` parent.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-21-linear-graphql-stage5-initiatives-design.md`

## Global Constraints

- API only; no REST routes; the web changes only to keep compiling (`WebhookResourceType`).
- Status values `Proposed`, `Planned`, `Active`, `Completed`, `Canceled`; default `Active`. Priority 0–4. `targetDateResolution` in `month`, `quarter`, `halfYear`, `year` or null. Health `onTrack`, `atRisk`, `offTrack`; updates default to `onTrack`.
- See: no lead team → users holding `projects.read` in any team; lead team → users holding `projects.read` in that team (`teamsGranting`). Write actions → `projects.<action>` in any team (workspace initiative) or in the lead team. Over MCP only MCP-enabled teams count.
- One parent per initiative, no loops, at most 5 levels counting the top initiative.
- Unsupported GraphQL input or argument (including every `sort`) → INVALID_INPUT naming it; `labelIds: []` is accepted as a no-op.
- Webhook scope: lead team → `[leadTeamId]`; workspace initiative → `[]` (all-teams webhooks only).
- Baseline migration regenerated on schema change: save the seed block at the end of `packages/db/drizzle/0000_*.sql`, delete that `.sql` and `meta/0000_snapshot.json` and `meta/_journal.json` by name, `rmdir` meta, `bun run db:generate`, append the seed block, drop and recreate the `*_test` schemas, `bun run db:migrate:test`.
- Commit after each task, no trailer (user instruction).

## Review Focus

1. An archived initiative is left out of `initiatives`, `subInitiatives` and `Project.initiatives` unless `includeArchived`, but `initiative(id)` still returns it. Test in Task 4.
2. Changing `leadTeamId` to a team the caller is not a member of → FORBIDDEN; to a team the owner cannot see → INVALID_INPUT unless `ownerId` is changed in the same call. Test in Task 1.
3. Deleting a team turns its initiatives into workspace initiatives visible to a member of another team. Test in Task 1.
4. Leaving `Completed` clears `completedAt`; re-entering `Active` sets a new `startedAt`. Test in Task 1.
5. Linking a project the caller cannot see → ENTITY_NOT_FOUND; linking it twice → INVALID_INPUT. Test in Task 5.

---

### Task 1: Schema, access and the initiative store

**Files:**
- Modify: `packages/db/src/schema/app.ts` (tables `initiative`, `initiative_to_project`, `initiative_relation`, `initiative_update` per spec; `comment.initiative_update_id`, `reaction.initiative_update_id`, both parent checks count it; `feed_entry` view carries `initiative_update_id`), regenerate baseline
- Create: `apps/api/src/initiatives/access.ts`, `apps/api/src/initiatives/store.ts`
- Modify: `apps/api/src/webhooks/store.ts` (types `Initiative`, `InitiativeUpdate`), `apps/api/src/webhooks/data.ts` (`initiativeData`), `apps/web/src/lib/api.ts` (union)
- Test: `apps/api/src/initiatives/__tests__/integration/initiatives.test.ts`

**Interfaces:**
- Produces (`access.ts`):
  - `visibleInitiativesSql(userId: string, opts?: { mcpOnly?: boolean }): Promise<SQL>`: SQL over `initiative`.
  - `canSeeInitiative(userId: string, leadTeamId: string | null): Promise<boolean>`.
  - `assertInitiativeAccess(id: string, userId: string, action: PermissionAction, opts?): Promise<InitiativeRow>`: 404 when not visible or missing, 403 when not granted.
  - `assertCanCreateInitiative(userId: string, leadTeamId: string | null, opts?): Promise<void>`: 403.
  - `assertLeadTeamMember(userId: string, leadTeamId: string): Promise<void>`: 403.
- Produces (`store.ts`):
  - `type InitiativeStatus`.
  - `InitiativeRow { id; name; description: string | null; content: string | null; color; icon; status; ownerUserId; creatorUserId; leadTeamId; priority; sortOrder; prioritySortOrder; targetDate: string | null; targetDateResolution; startedAt; completedAt; slugId; archivedAt; trashed: boolean | null; createdAt; updatedAt }` (timestamps as `iso()` strings).
  - `getInitiative(idOrSlug: string): Promise<InitiativeRow | null>`.
  - `createInitiative(input: NewInitiativeInput, actorUserId: string)`, where `NewInitiativeInput = { id?; name; description?; content?; color?; icon?; status?; ownerId?; leadTeamId?; priority?; sortOrder?; prioritySortOrder?; targetDate?; targetDateResolution? }`.
  - `updateInitiative(id, patch: Partial<Omit<NewInitiativeInput,'id'>>, actorUserId)`.
  - `archiveInitiative(id, actorUserId, opts?: { trash?: boolean })`, `unarchiveInitiative(id, actorUserId)`.
  - `sendInitiativeEvent(action: WebhookAction, id: string, actorUserId: string | null, before?: WebhookData | null)`. Team ids are `[leadTeamId]` or `[]`; on a lead-team change, the new team.
  - The store validates: an empty name, priority outside 0–4, and an owner who can't see the initiative (also on a lead-team change, with the resulting owner) each give 400. It also applies the status timestamp rule.
- Produces (`webhooks/data.ts`): `initiativeData(id): Promise<WebhookData | null>`. Fields from Linear's `InitiativeWebhookPayload` that this stage has: `ownerId`, `creatorId`, `leadTeamId`, `labelIds: []`, `projects`, `parentInitiative`, `subInitiatives` (child payloads `{ id, name, url }`, sorted by id), `health`, `lastUpdateId`. `projects`, `health` and `lastUpdateId` are filled in by Tasks 2–3. Until then they're `[]` and null.

- [ ] **Step 1: Write the failing tests** (store and access calls; users and teams built through the REST API):
  - `creates with Linear's defaults`: status `Active`, `startedAt` set, `completedAt` null, priority 0, `slugId` 12 hex chars.
  - `status timestamps`: Active → Completed sets `completedAt`. → Planned clears it. → Active sets a `startedAt` later than the first.
  - `archive, delete and unarchive`: archive sets `archivedAt`, `trashed` null. Delete sets both (`trashed: true`). Unarchive clears both.
  - `visibility by lead team`: a workspace initiative is visible to a member of another team (`visibleInitiativesSql` / `assertInitiativeAccess` read). A lead-team initiative gives 404 for a non-member of that team. A member without `projects.edit` (custom role) gets 403 on edit.
  - `owner and lead team rules`:
    - an owner who isn't in the lead team gives 400;
    - changing `leadTeamId` so the owner can't see the initiative gives 400;
    - the same change with a new `ownerId` succeeds;
    - `assertLeadTeamMember` for a team the caller isn't in gives 403.
  - `team delete makes its initiatives workspace-wide`: delete the lead team through REST, and a member of another team can read the initiative.
  - `sends Initiative webhooks`: an `Initiative` webhook on the lead team receives `create`, then `update` with `updatedFrom.name`, then `remove` on archive.
  - `rejects bad input`: empty name and priority 5 each give 400.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/initiatives`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** Schema first, then regenerate the baseline per Global Constraints. Then access, store and data.
- [ ] **Step 4: Run** the step 2 command. Expected: PASS. Root `bun run typecheck` has 0 errors. `bun test --env-file=../../.env.test src/comments src/reactions` passes.
- [ ] **Step 5: Commit** `feat(api): add initiatives`

### Task 2: Project links and sub-initiatives

**Files:**
- Create: `apps/api/src/initiatives/links.ts`
- Modify: `apps/api/src/webhooks/data.ts` (fill `projects`, `parentInitiative`, `subInitiatives`)
- Test: `apps/api/src/initiatives/__tests__/integration/links.test.ts`

**Interfaces:**
- Consumes: `getInitiative`, `sendInitiativeEvent` (Task 1).
- Produces:
  - Rows:
    - `InitiativeToProjectRow { id; initiativeId; projectId; sortOrder: number; createdAt; updatedAt }`;
    - `InitiativeRelationRow { id; initiativeId; relatedInitiativeId; sortOrder: number; userId: string | null; createdAt; updatedAt }`.
  - Project links:
    - `linkProject(input: { initiativeId; projectId; sortOrder?; id? }, actorUserId)`: 400 when already linked;
    - `updateProjectLink(id, { sortOrder }, actorUserId)`, `unlinkProject(id, actorUserId)`, `getProjectLink(id)`.
  - Relations:
    - `createRelation(input: { initiativeId; relatedInitiativeId; sortOrder?; id? }, actorUserId)`: 400 on self, second parent, loop, or depth over 5. The messages name no initiative;
    - `updateRelation(id, { sortOrder }, actorUserId)`, `deleteRelation(id, actorUserId)`, `getRelation(id)`.
  - `visibleSubtreeIds(rootId: string, visible: SQL): Promise<string[]>`: the root plus descendants reachable through initiatives matching `visible`, as a recursive CTE.
  - Webhooks: every link or relation change sends an `Initiative` `update` for each initiative involved, passing its before-data.
  - The default `sortOrder` is the current maximum among siblings + 1000.
  - Depth rule: (ancestors of the parent, including the parent) + (height of the child's subtree, including the child) ≤ 5.

- [ ] **Step 1: Write the failing tests:**
  - `links a project once`: a second link gives 400. Unlinking removes it.
  - `one parent, no loops`: B under A, then B under C gives 400. A under B gives 400 (loop). A under A gives 400.
  - `depth limit`: a chain of 5 levels is accepted. A sixth level gives 400. Attaching a 2-level subtree under level 4 gives 400.
  - `subtree stops at hidden initiatives`: child B with a lead team the viewer isn't in, grandchild C workspace-wide. `visibleSubtreeIds(A, visibleSql)` is `[A]`.
  - `link and relation changes send Initiative updates`: after linking, the Initiative webhook's `data.projects` has the project id. After `createRelation`, both parent and child get an `update`.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/initiatives`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Typecheck has 0 errors.
- [ ] **Step 5: Commit** `feat(api): link projects and nest initiatives`

### Task 3: Initiative updates, comments and reactions on them

**Files:**
- Create: `apps/api/src/initiatives/updates.ts`
- Modify:
  - `apps/api/src/comments/store.ts`: `CommentParent`, `CommentRow`, `mapComment`, `commentParentUrl` (the initiative URL), `commentTeamIds` (lead team or `[]`), `assertParentAccess` (`assertInitiativeAccess` read), `commentParent`, `readableCommentsSql`.
  - `apps/api/src/reactions/store.ts`: `ReactionParent`, `ReactionRow`, `reactionTeamIds`.
  - `apps/api/src/webhooks/data.ts`: `initiativeUpdateData`, plus `health` and `lastUpdateId` in `initiativeData`.
  - Activity or feed code reading `feed_entry` columns, where types require it.
- Test: `apps/api/src/initiatives/__tests__/integration/updates.test.ts`

**Interfaces:**
- Consumes: `assertInitiativeAccess`, `getInitiative` (Task 1).
- Produces:
  - `InitiativeUpdateRow { id; initiativeId; userId; body; health: UpdateHealth; editedAt; archivedAt; createdAt; updatedAt }`.
  - `createInitiativeUpdate(initiativeId, userId, input: { body: string; health?: UpdateHealth; id? })`.
  - `updateInitiativeUpdate(id, patch: { body?; health? }, actorUserId)`: sets `editedAt`.
  - `setInitiativeUpdateArchived(id, archived: boolean, actorUserId)`.
  - `getInitiativeUpdate(id)`.
  - `latestInitiativeUpdate(initiativeId): Promise<InitiativeUpdateRow | null>`: newest that isn't archived.
  - `InitiativeUpdate` webhooks are `create` / `update` / `remove` (on archive) and go to `[leadTeamId]` or `[]`. Posting an update sends no Initiative event. `UpdateHealth` is imported from `projects/updates.ts`.
  - `createComment({ initiativeUpdateId, ... })` and `createReaction({ initiativeUpdateId, ... })` accept the new parent.

- [ ] **Step 1: Write the failing tests:**
  - `health comes from the newest update`: post atRisk, then offTrack, and `latestInitiativeUpdate` is offTrack. Archive it, and the latest is atRisk. With no updates it's null.
  - `defaults health to onTrack and marks edits`.
  - `comments and reactions on an update`: `createComment({ initiativeUpdateId })` and `createReaction({ initiativeUpdateId })` succeed for a viewer. A non-member of the lead team gets 404 from `assertParentAccess` / `assertReactionParentAccess`.
  - `sends InitiativeUpdate webhooks`: create, update, and remove on archive.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/initiatives`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the step 2 command plus `src/comments src/reactions src/graphql/__tests__/integration/comments.test.ts src/graphql/__tests__/integration/reactions.test.ts`. Expected: PASS. Typecheck has 0 errors.
- [ ] **Step 5: Commit** `feat(api): add initiative updates with comments and reactions`

### Task 4: GraphQL initiatives (queries, filters, mutations)

**Files:**
- Create:
  - `apps/api/src/graphql/resolvers/initiative.ts`: `toInitiative`; queries `initiative`, `initiatives`; `Initiative.*` relations; `Project.initiatives`;
  - `apps/api/src/graphql/resolvers/initiative-mutations.ts`: `initiativeCreate`, `initiativeUpdate`, `initiativeArchive`, `initiativeUnarchive`, `initiativeDelete`;
  - `apps/api/src/graphql/initiative-filter.ts`.
- Modify: `apps/api/src/graphql/mount.ts` (register), `apps/api/src/graphql/project-filter.ts` (`initiatives`: `some`, `every`, `length`)
- Test: `apps/api/src/graphql/__tests__/integration/initiatives.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 store and access functions.
- Produces:
  - `toInitiative(row: InitiativeRow)` with schema fields:
    - `visibility`: `public` without a lead team, `private` with one;
    - `url`: `${trustedOrigins[0]}/initiatives/${id}`;
    - `frequencyResolution: 'weekly'`, `labelIds: []`;
    - `health`, `healthUpdatedAt` from `latestInitiativeUpdate` in field resolvers.
  - `initiativeFilterSql(filter: unknown, viewerId: string): SQL | undefined`, with the fields listed in the spec. `owner`, `creator` and `leadTeam` support `id` and `null`. `health` compares the latest update's health through a subquery.
  - Every `sort` argument is rejected with `INVALID_INPUT` naming `sort`.
  - `Initiative.projects` uses `visibleSubtreeIds` (or just the initiative when `includeSubInitiatives: false`), intersected with the projects the viewer can see.
  - `subInitiatives` and `parentInitiative` return visible initiatives only.
  - Mutations check `assertCanCreateInitiative` / `assertInitiativeAccess(edit|delete)` / `assertLeadTeamMember` and call `onlySupported`.

- [ ] **Step 1: Write the failing tests** (real SDK via `linearClient`, raw `gql` for errors):
  - `creates, reads by id and slug, updates and archives`: `createInitiative({ name: 'Q1' })` → `status` `Active`, `visibility` `public`. Reading by `slugId` returns the same id. `updateInitiative({ status: 'Completed' })` sets `completedAt`. `archiveInitiative` removes it from `initiatives()`. `initiatives({ includeArchived: true })` has it. `initiative(id)` still returns it.
  - `delete trashes and unarchive restores`: `trashed` is true, then null.
  - `hides lead-team initiatives from non-members`: `initiative(id)` gives ENTITY_NOT_FOUND. `initiatives` is empty.
  - `rejects a lead team the caller is not in`: FORBIDDEN.
  - `filters initiatives`: by `status: { eq: "Planned" }`, `owner: { null: true }`, `leadTeam: { id: { eq } }`.
  - `rejects sort and unsupported input`: `initiatives(sort: …)` gives INVALID_INPUT naming `sort`. `initiativeCreate(input: { updateRemindersDay: … })` gives INVALID_INPUT naming the field. `labelIds: []` is accepted.
  - `Project.initiatives and ProjectFilter.initiatives`: a project linked to an initiative lists it. `projects(filter: { initiatives: { some: { id: { eq } } } })` returns that project only.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/initiatives.test.ts`. Expected: FAIL (NOT_IMPLEMENTED).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `bun test --env-file=../../.env.test src/graphql` passes, apart from tests that used Initiative as an example of something unsupported. Switch those to a type that's still unimplemented, such as Document.
- [ ] **Step 5: Commit** `feat(api): serve initiatives over GraphQL`

### Task 5: GraphQL links, relations, updates; comments and reactions; docs

**Files:**
- Modify:
  - `apps/api/src/graphql/resolvers/initiative.ts`: queries `initiativeToProject(s)`, `initiativeRelation(s)`, `initiativeUpdate`, `initiativeUpdates`; `Initiative.projects`, `subInitiatives`, `initiativeUpdates`, `lastUpdate`; `Project.initiativeToProjects`; `InitiativeUpdate.initiative`, `.user`; `initiativeUpdateFilterSql`.
  - `apps/api/src/graphql/resolvers/initiative-mutations.ts`: `initiativeToProject{Create,Update,Delete}`, `initiativeRelation{Create,Update,Delete}`, `initiativeUpdate{Create,Update,Archive,Unarchive}`.
  - `apps/api/src/graphql/resolvers/comment.ts`: `initiativeUpdateId` input; `InitiativeUpdate.comments` and `commentCount`; `Comment.initiativeUpdate`.
  - `apps/api/src/graphql/resolvers/reaction.ts`: `initiativeUpdateId` input; `InitiativeUpdate.reactions` and `reactionData`.
  - Docs: `apps/api/AGENTS.md` (an Initiatives bullet under Data invariants; the Access, Coverage and webhook resource lists), `README.md` if it lists GraphQL coverage, and memory `linear-graphql-staged-plan.md`.
- Test: `apps/api/src/graphql/__tests__/integration/initiatives.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `InitiativeToProject.sortOrder` is a string (`String(sortOrder)`); `InitiativeRelation.sortOrder` is a float.
  - A link or relation is listed only when both ends are visible.
  - `initiativeUpdateCreate` needs `edit` on the initiative.
  - `InitiativeUpdate`: `isStale: false`, `isDiffHidden: false`, `diff` and `diffMarkdown` null. `url` is `${trustedOrigins[0]}/initiatives/${initiativeId}`.
  - `isDiffHidden` in the create input gives INVALID_INPUT.

- [ ] **Step 1: Write the failing tests:**
  - `links projects and lists them through sub-initiatives`:
    - project P1 on A and P2 on child B (relation created through `createInitiativeRelation`);
    - `A.projects()` has both, and `includeSubInitiatives: false` has P1 only;
    - `B.parentInitiative` is A; `A.subInitiatives()` is [B].
  - `rejects a duplicate link, a hidden project and a loop`:
    - linking P1 again gives INVALID_INPUT;
    - linking a project of a team the caller isn't in gives ENTITY_NOT_FOUND;
    - a relation A under B gives INVALID_INPUT.
  - `posts updates and derives health`: `createInitiativeUpdate({ health: 'atRisk' })` → `initiative.health` atRisk, `lastUpdate.id` matches, `healthUpdatedAt` set. `archiveInitiativeUpdate` → health null.
  - `comments and reacts on an update`: `createComment({ initiativeUpdateId })` → `update.comments()` has it, `commentCount` 1, `comment.initiativeUpdate.id` matches. `createReaction({ initiativeUpdateId, emoji: '👍' })` → `reactionData` has 👍.
  - `sends Initiative and InitiativeUpdate webhooks over GraphQL`: an all-teams webhook with both types receives `Initiative` create for a workspace initiative and `InitiativeUpdate` create.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/initiatives.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, then update the docs.
- [ ] **Step 4: Run** the step 2 command. Expected: PASS. Then from the root: `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run build`, and the full API suite. Expected: green apart from the S3-only tests that need MinIO.
- [ ] **Step 5: Commit** `feat(api): link, nest and post updates on initiatives over GraphQL`

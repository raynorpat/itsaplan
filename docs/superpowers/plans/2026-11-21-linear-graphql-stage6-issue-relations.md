# Stage 6: Issue Relations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's issue relations (blocks, related, duplicate) over `/graphql`, with history entries and duplicates closed.

**Architecture:** Rules live in `apps/api/src/issues/relations.ts`; GraphQL resolvers in `apps/api/src/graphql/resolvers/issue-relation.ts` check access and call it. The web feed renders the new `relation` activity.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-21-linear-graphql-stage6-issue-relations-design.md`

## Global Constraints

- Types `blocks`, `duplicate`, `related`; `similar` → INVALID_INPUT. One relation per unordered pair; no self-relation.
- Visible only when both issues are visible; writes need `work_items.edit` in either issue's team.
- Duplicate → the team's canceled state named "Duplicate" (case-insensitive), else the first canceled state by position; skipped when already completed/canceled; through `updateIssue`.
- History action `relation`, subjects `blocks`, `blocked_by`, `duplicate_of`, `duplicated_by`, `related`; `toText` on add, `fromText` on remove; issue identifiers like `MKT-3`.
- Baseline migration regenerated (save the seed block from the `.sql`, delete the `.sql` and both `meta/` files by name, `rmdir` meta, `bun run db:generate`, append the seed, drop/recreate the `*_test` schemas, `bun run db:migrate:test`).
- Commit after each task, no trailer (user instruction).

## Review Focus

1. Creating B→A when A→B exists (reverse direction) → INVALID_INPUT. Test in Task 1.
2. A duplicate whose issue is already completed keeps its state. Test in Task 1.
3. A relation to an issue in a team the viewer is not in is hidden from `relations`, `inverseRelations`, `issueRelations` and the `has*Relations` filters. Test in Task 2.
4. `issueRelationUpdate` changing the type to `duplicate` closes the issue. Test in Task 2.
5. Deleting an issue removes its relations (cascade). Test in Task 1.

---

### Task 1: Schema, relation store, history, web feed text

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`issueRelation` table), regenerate baseline
- Create: `apps/api/src/issues/relations.ts`
- Modify: `apps/web/src/features/issue/utils/activityText.tsx` (`relation` case)
- Test: `apps/api/src/issues/__tests__/integration/relations.test.ts`

**Interfaces:**
- Produces:
  - `type IssueRelationType = 'blocks' | 'duplicate' | 'related'`
  - `IssueRelationRow { id; issueId; relatedIssueId; type: IssueRelationType; createdAt; updatedAt }`
  - `getIssueRelation(id): Promise<IssueRelationRow | null>`
  - `createIssueRelation(input: { issueId; relatedIssueId; type: string; id? }, actorUserId: string)` — 400 self / pair exists / unknown or `similar` type
  - `updateIssueRelation(id, patch: { issueId?; relatedIssueId?; type? }, actorUserId)` — same checks (the pair check ignores the relation itself)
  - `deleteIssueRelation(id, actorUserId)`
- History: both issues get `relation` entries; the duplicate rule runs after the write.

- [ ] **Step 1: Write the failing tests** (issues created through REST, store calls for relations, history read through `GET /issues/:id/feed`):
  - `creates a blocking relation and logs it on both issues` — feed of A has `{ action: 'relation', subject: 'blocks', toText: B identifier }`, feed of B has `subject: 'blocked_by'`.
  - `rejects a self relation, a second relation in either direction and similar` — all 400.
  - `closes a duplicate in the team's Duplicate state` — team gets a canceled state "Duplicate" through REST; after a `duplicate` relation A→B, A's state is that state; a second team without one → first canceled state.
  - `leaves a completed duplicate alone` — A in a completed state keeps it.
  - `changing a relation logs a removal and an addition` — update type `blocks` → `related`; A's feed has `fromText` entry for `blocks` and `toText` entry for `related`.
  - `deleting an issue removes its relations` — after deleting B, `getIssueRelation(id)` is null.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/issues/__tests__/integration/relations.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** (schema → baseline regen → store → web text).
- [ ] **Step 4: Run** — Expected: PASS; root `bun run typecheck` 0 errors.
- [ ] **Step 5: Commit** `feat(api): add issue relations`

### Task 2: GraphQL relations and filters, docs

**Files:**
- Create: `apps/api/src/graphql/resolvers/issue-relation.ts` (queries `issueRelation`, `issueRelations`; `Issue.relations`, `Issue.inverseRelations`; `IssueRelation.issue`, `.relatedIssue`; mutations)
- Modify: `apps/api/src/graphql/mount.ts`, `apps/api/src/graphql/issue-filter.ts` (four `has*Relations` handlers), `apps/api/AGENTS.md`, `README.md`, memory `linear-graphql-staged-plan.md`
- Test: `apps/api/src/graphql/__tests__/integration/issue-relations.test.ts`

**Interfaces:**
- Consumes: Task 1 store.
- Produces: visible-only connections (both issue ids in the viewer's member teams); mutations check `findIssue` on both issues (ENTITY_NOT_FOUND) and `work_items.edit` in either team (FORBIDDEN); payloads `IssueRelationPayload { success, lastSyncId, issueRelation }`, delete `DeletePayload { entityId }`.

- [ ] **Step 1: Write the failing tests** (real SDK):
  - `creates, reads and deletes a relation` — `createIssueRelation({ issueId: A, relatedIssueId: B, type: IssueRelationType.Blocks })`; `A.relations()` has it with `relatedIssue.id === B`; `B.inverseRelations()` has it; `issueRelation(id)` and `issueRelations()` return it; `deleteIssueRelation` → gone.
  - `changing the type to duplicate closes the issue` — `updateIssueRelation(id, { type: 'duplicate' })` → A's state type `canceled`.
  - `hides relations to issues the viewer cannot see` — A in MKT, C in a team only the owner is in; a MKT member sees no relations on A, empty `issueRelations`, and `hasBlockingRelations: { eq: true }` does not return A; the owner does.
  - `filters by relation existence` — `hasBlockedByRelations: { eq: true }` returns B only; `hasRelatedRelations: { eq: false }` excludes a related pair.
  - `rejects similar and unsupported input` — `type: similar` → INVALID_INPUT; a non-member of both teams → ENTITY_NOT_FOUND; a member without `work_items.edit` (custom role) in either team → FORBIDDEN.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/issue-relations.test.ts` — Expected: FAIL (NOT_IMPLEMENTED).
- [ ] **Step 3: Implement**, then docs.
- [ ] **Step 4: Run** — Expected: PASS; root `bun run format:check`, `lint`, `typecheck`, `build`, full API suite green except the S3-only tests.
- [ ] **Step 5: Commit** `feat(api): serve issue relations over GraphQL`

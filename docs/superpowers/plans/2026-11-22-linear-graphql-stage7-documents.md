# Stage 7: Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's documents (in a project or on an issue) and comments on them over `/graphql`, with Document webhooks.

**Architecture:** `apps/api/src/documents/` holds `access.ts` (parent access) and `store.ts` (rules, webhooks). Comments gain a `document_id` parent. GraphQL resolvers in `resolvers/document.ts` check access and call the store; the document id doubles as Linear's `documentContentId`.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-22-linear-graphql-stage7-documents-design.md`

## Global Constraints

- Exactly one parent (`project_id` or `issue_id`); both or neither → INVALID_INPUT.
- Project document: read via a project team granting `projects.read`; writes `projects.edit`. Issue document: read by issue-team members; writes `work_items.edit`. Moving needs write access to both parents.
- Archived or trashed documents and documents of archived parents are hidden from lists unless `includeArchived`; `document(id)` returns them. Writes into an archived parent → INVALID_INPUT.
- `documentDelete` = archive + `trashed: true`; `documentUnarchive` clears both; both return `DocumentArchivePayload { success, lastSyncId, entity }`.
- Unsupported inputs (`releaseId`, `lastAppliedTemplateId`, `trashed` on update, …) → INVALID_INPUT naming the field.
- Webhook `Document` (`create`, `update`, `remove`), scoped to the parent's teams; a move reaches old and new teams in one `update`.
- No REST, MCP, history, feed or notification work.
- Baseline migration regenerated (save the seed block, delete the `.sql` and both `meta/` files by name, `rmdir` meta, `bun run db:generate`, append seed, reset the `*_test` schemas, `bun run db:migrate:test`).
- Commit after each task, no trailer. Questions are settled the way Linear does.

## Review Focus

1. A project document seen by a member whose role lacks `projects.read` → hidden (404 / not listed). Test in Task 1.
2. Moving a document from a project to an issue clears `project_id`, needs write access to both, and the webhook reaches both teams. Test in Task 1.
3. Documents of an archived project are hidden from `Project.documents` / `documents` unless `includeArchived`. Test in Task 3.
4. A comment on a document is hidden from a user who cannot see the document, through `comments`, `Document.comments` and `comment(id)`. Test in Task 2.
5. `documentDelete` then `documentUnarchive` round-trips `trashed` and `archivedAt`. Test in Task 3.

---

### Task 1: Schema, access, document store, webhooks

**Files:**
- Modify: `packages/db/src/schema/app.ts` (`document` table per spec; `comment.document_id` FK cascade + parent check + index; `feed_entry` carries `document_id`), regenerate baseline
- Create: `apps/api/src/documents/access.ts`, `apps/api/src/documents/store.ts`
- Modify: `apps/api/src/webhooks/store.ts` (`Document`), `apps/api/src/webhooks/data.ts` (`documentData`), `apps/web/src/lib/api.ts` (resource type union + label), tests that used `Document` as an unsupported example (switch to a still-unsupported type such as `Customer`)
- Test: `apps/api/src/documents/__tests__/integration/documents.test.ts`

**Interfaces:**
- `type DocumentParent = { projectId: string } | { issueId: string }`
- `access.ts`: `assertDocumentParentAccess(parent: DocumentParent, user: AuthUser, action: 'read' | 'edit'): Promise<void>` (404 unreadable, 403 no write); `visibleDocumentsSql(userId: string): Promise<SQL>` (SQL over `document`: readable parent, not filtering archive); `canSeeDocument(userId, parent): Promise<boolean>`
- `store.ts`: `DocumentRow { id; title; content: string | null; icon; color; sortOrder; slugId; projectId: string | null; issueId: string | null; creatorUserId; updatedByUserId; ownerUserId; hiddenAt; archivedAt; trashed: boolean | null; createdAt; updatedAt }`; `getDocument(idOrSlug)`; `createDocument(input: { title; content?; icon?; color?; sortOrder?; projectId?; issueId?; ownerId?; id? }, actorUserId)`; `updateDocument(id, patch: { title?; content?; icon?; color?; sortOrder?; projectId?; issueId?; ownerId?; hiddenAt? }, actorUserId)`; `archiveDocument(id, actorUserId)` (trash); `unarchiveDocument(id, actorUserId)`; `documentParent(row): DocumentParent`; `documentTeamIds(parent): Promise<string[]>`; `isParentArchived(parent): Promise<boolean>`; `documentUrl(row): string`.
- Store validates: title non-empty, one parent, parent not archived (create, move, unarchive), owner can see the document; sends Document webhooks (`create`, `update` with before-data and old+new teams, `remove`).

- [ ] **Step 1: Write the failing tests** (projects/issues/roles via REST; store + access calls):
  - `creates a project document with defaults` — `slugId` 12 hex, `creatorUserId` and `updatedByUserId` = actor, `trashed` null; `getDocument(slugId)` finds it.
  - `requires exactly one parent and a non-empty title` — none / both / `title: ' '` → 400.
  - `hides a project document from a member who cannot read projects` — role `{ projects: {} }` → `assertDocumentParentAccess(..., 'read')` 404; issue document visible to team member, `edit` 403 for a `work_items: { read: true }` role.
  - `moves a document from a project to an issue` — `projectId` null after; webhook on each team receives one `update`.
  - `rejects an archived parent` — archive the project via REST; `createDocument` in it → 400; `unarchiveDocument` of a trashed doc under it → 400.
  - `deletes to the trash and restores` — `archivedAt` + `trashed: true`, then both cleared; webhook `remove` then `update`.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/documents` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; `bun run typecheck` 0 errors; `src/comments src/webhooks src/graphql` still pass.
- [ ] **Step 5: Commit** `feat(api): add documents`

### Task 2: Comments on documents

**Files:**
- Modify: `apps/api/src/comments/store.ts` (`CommentParent` + `{ documentId }`, `CommentRow.documentId`, `mapComment`, `createComment`, `sameParent`, `commentParentUrl`, `commentTeamIds`, `assertParentAccess`, `commentParent`, `readableCommentsSql`), `apps/api/src/graphql/resolvers/comment.ts` (`documentContentId` input → `{ documentId }`, `Comment.documentContentId`, `Comment.documentContent`, `Document.comments`)
- Test: `apps/api/src/documents/__tests__/integration/document-comments.test.ts`

**Interfaces:**
- Consumes: `assertDocumentParentAccess`, `getDocument`, `documentParent`, `documentTeamIds`, `visibleDocumentsSql`, `documentUrl` (Task 1).
- `toDocumentContent(row: DocumentRow)` exported from `resolvers/document.ts` (Task 3 fills the rest of that file): `{ id: row.id, content, createdAt, updatedAt, documentId: row.id }`.

- [ ] **Step 1: Write the failing tests:**
  - `comments on a document through the store` — `createComment({ parent: { documentId } })` → row has `documentId`; `assertParentAccess` 404 for a user who cannot see the project.
  - `sends the Comment webhook to the document's teams`.
  - `GraphQL commentCreate with documentContentId` — SDK `createComment({ documentContentId: doc.id, body })` → `comment.documentContentId === doc.id`, `(await comment.documentContent).id === doc.id`; an outsider's `comment(id)` → ENTITY_NOT_FOUND.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/documents` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** plus `src/comments src/graphql/__tests__/integration/comments.test.ts` — Expected: PASS; typecheck 0 errors.
- [ ] **Step 5: Commit** `feat(api): comment on documents`

### Task 3: GraphQL documents, filter, docs

**Files:**
- Create/extend: `apps/api/src/graphql/resolvers/document.ts` (`toDocument`, queries `document`, `documents`; `Document.*`; `DocumentContent.*`; `Project.documents`, `Issue.documents`; mutations `documentCreate`, `documentUpdate`, `documentDelete`, `documentUnarchive`), `apps/api/src/graphql/document-filter.ts`
- Modify: `apps/api/src/graphql/mount.ts`, `apps/api/AGENTS.md`, `README.md`, memory `linear-graphql-staged-plan.md`
- Test: `apps/api/src/graphql/__tests__/integration/documents.test.ts`

**Interfaces:**
- `toDocument(row)`: row fields plus `documentContentId: row.id`, `url: documentUrl(row)`, `trashed`.
- `documentFilterSql(filter, viewerId): SQL | undefined` with spec fields; `team` matches the issue's team or a project team.
- List scope: `visibleDocumentsSql` AND (includeArchived OR (doc not archived AND parent not archived)).

- [ ] **Step 1: Write the failing tests** (real SDK, raw `gql` for errors):
  - `creates, reads by id and slug, updates and lists` — `createDocument({ title, content, projectId })`; `document(slugId)`; `updateDocument({ title })` sets `updatedBy`; `project.documents()` and `documents()` list it; `issue.documents()` for an issue document.
  - `delete trashes and unarchive restores` — `deleteDocument` → `entity.trashed` true, hidden from `documents()`, `document(id)` still returns; `unarchiveDocument` → visible.
  - `hides documents of archived projects unless includeArchived`.
  - `hides documents from users who cannot see the parent` — ENTITY_NOT_FOUND / empty list.
  - `filters documents` — by `title`, `project: { id }`, `issue: { id }`, `team: { id }`, `creator: { id }`.
  - `rejects unsupported input` — `releaseId`, `trashed` on update, both `projectId` and `issueId` → INVALID_INPUT naming the field / rule.
  - `sends a Document webhook on documentCreate` (team webhook with `Document`).
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/documents.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, then docs.
- [ ] **Step 4: Run** — Expected: PASS; root `format:check`, `lint`, `typecheck`, `build`; full API suite green except S3-only tests.
- [ ] **Step 5: Commit** `feat(api): serve documents over GraphQL`

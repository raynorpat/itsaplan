# Stage 8: Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's `Attachment` (links and the existing file uploads, in one table) over `/graphql`, with Attachment webhooks.

**Architecture:** `issue_attachment` becomes `attachment` with Linear's fields; file columns are nullable. `apps/api/src/attachments/store.ts` owns every write (links and files) and sends the webhooks; the REST routes and the new GraphQL resolvers (`resolvers/attachment.ts`, `attachment-filter.ts`) call it.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's vendored SDL, `@linear/sdk` in tests.

**Spec:** `docs/superpowers/specs/2026-11-22-linear-graphql-stage8-attachments-design.md`

## Global Constraints

- One table `attachment`; file columns (`public_id`, `s3_key`, `filename`, `content_type`, `size_bytes`) all set or all null (check); unique (`issue_id`, `url`).
- Uploads store `url = /attachments/<publicId>/raw`, `title = filename`, `source_type = 'upload'`; links have `source_type` null.
- Output URLs of files are absolute on the API origin (`process.env.API_URL`); incoming URLs that start with `${API_URL}/attachments/` lose the origin before matching.
- Link URLs must be absolute `http:`/`https:` (INVALID_INPUT otherwise); title trimmed, non-empty.
- `attachmentCreate` upserts by (`issueId`, `url`); upsert onto a file keeps `source_type = 'upload'` and the file columns. `attachmentLinkURL` without `title`: URL on create, existing title on update.
- Access: read = read on the issue; create/link/upsert `work_items.create`; update `work_items.edit`; delete `work_items.delete` (the issue's team).
- Webhook `Attachment` (`create`, `update`, `remove`), scope the issue's team; REST uploads and deletes send them too; issue delete sends none per attachment.
- REST list, team quota, storage totals count only rows with an `s3_key`.
- No web UI, MCP, history, unfurling or integration mutations. `createAsUser`, `displayIconUrl` → INVALID_INPUT naming the field.
- Baseline migration regenerated (save the seed block, delete the `.sql` and both `meta/` files by name, `rmdir` meta, `bun run db:generate`, append seed, reset the `*_test` schemas, `bun run db:migrate:test`).
- MinIO is not available locally: tests create file rows with the store's `createAttachment` (no S3); object deletes are best-effort.
- Commit after each task, no trailer. Questions are settled the way Linear does.

## Review Focus

1. `attachmentCreate` with a file's absolute URL updates that file (no second row, `sourceType` stays `upload`). Test in Task 2.
2. `javascript:alert(1)` and a relative URL as a link → INVALID_INPUT. Test in Task 1.
3. A user outside the issue's team sees no attachment through `attachment(id)`, `attachments`, `attachmentsForURL` or `Issue.attachments`. Test in Task 2.
4. Deleting a file attachment over GraphQL removes its embed from the issue description. Test in Task 2.
5. A link on an issue does not appear in the REST list and does not count toward the team quota. Test in Task 1.

---

### Task 1: Schema, store, webhooks, REST on the new table

**Files:**
- Modify: `packages/db/src/schema/app.ts` (rename table/export to `attachment`, new columns, check, unique index), regenerate baseline
- Modify: `apps/api/src/attachments/store.ts`, `apps/api/src/attachments/routes.ts`, `apps/api/src/issues/store.ts`, `apps/api/src/shared/s3.ts` (comment), `apps/worker/src/telemetry.ts`, `apps/api/src/webhooks/store.ts` (`Attachment`), `apps/api/src/webhooks/data.ts` (`attachmentData`), `apps/web/src/lib/api.ts` (resource type + label), any god/storage totals reading the table
- Test: `apps/api/src/attachments/__tests__/integration/links.test.ts`

**Interfaces:**
- `AttachmentRow { id; issueId; url; title; subtitle: string | null; iconUrl: string | null; metadata: Record<string, unknown>; sourceType: string | null; groupBySource: boolean; creatorUserId: string | null; publicId: string | null; s3Key: string | null; filename: string | null; contentType: string | null; sizeBytes: number | null; createdAt; updatedAt }`
- `createAttachment({ issueId, s3Key, filename, contentType, sizeBytes, creatorUserId? }): Promise<AttachmentRow>` (file; generates `publicId` first so `url` can be set; sends `create`)
- `upsertLinkAttachment(input: { issueId; url; title?; subtitle?; iconUrl?; metadata?; groupBySource?; id? }, actorUserId): Promise<{ row: AttachmentRow; created: boolean }>` (validates, normalises, upserts, sends `create` or `update`)
- `updateAttachment(id, patch: { title?; subtitle?; iconUrl?; metadata? }, actorUserId): Promise<AttachmentRow | null>`
- `deleteAttachment(id, actorUserId): Promise<AttachmentRow | null>` (row, embeds, best-effort object delete, `remove`); REST delete looks up by `publicId` and calls it
- `getAttachment(id): Promise<AttachmentRow | null>`; `listAttachments(issueId)` returns files only; `normalizeAttachmentUrl(url): string`; `attachmentUrl(row): string` (absolute for files)

- [ ] **Step 1: Write the failing tests** (issue via REST, store calls, webhook deliveries via REST):
  - `creates a link with defaults` — `upsertLinkAttachment({ issueId, url: 'https://example.com/pr/1', title: 'PR 1' }, owner)` → `created` true, `metadata` `{}`, `sourceType` null, `creatorUserId` owner.
  - `upserts by issue and url` — second call with the same URL and `title: 'PR 1 v2'` → `created` false, same id, title updated; one row for the issue.
  - `rejects non-web urls and empty titles` — `javascript:alert(1)`, `/relative`, `ftp://x` and `title: ' '` → 400.
  - `marks uploads and normalises their absolute url` — `createAttachment({...file})` → `sourceType: 'upload'`, `url` `/attachments/<publicId>/raw`, `title` = filename; `attachmentUrl(row)` starts with `process.env.API_URL`; `upsertLinkAttachment({ url: attachmentUrl(row), title: 'Renamed' })` → `created` false, same id, `sourceType` still `upload`, `s3Key` unchanged.
  - `keeps links out of the REST list and quota` — after one link and one file, `GET /issues/:id/attachments` returns only the file; `getTeamAttachmentBytes` equals the file size.
  - `sends Attachment webhooks` — team webhook with `['Attachment']`: create link, update it, delete it → actions `create`, `update`, `remove`, `data.issueId` set, `data.source` null.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/attachments/__tests__/integration/links.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, migration, store, webhook payload, callers.
- [ ] **Step 4: Run** — Expected: PASS; `bun run typecheck` 0 errors; `src/issues src/webhooks src/graphql` still pass (attachment upload tests need MinIO and stay failing as before).
- [ ] **Step 5: Commit** `feat(api): store links and files as attachments`

### Task 2: GraphQL attachments

**Files:**
- Create: `apps/api/src/graphql/resolvers/attachment.ts` (`toAttachment`; queries `attachment`, `attachments`, `attachmentsForURL`, `attachmentIssue`; `Attachment.*`; `Issue.attachments`; mutations `attachmentCreate`, `attachmentUpdate`, `attachmentLinkURL`, `attachmentDelete`)
- Modify: `apps/api/src/graphql/mount.ts`
- Test: `apps/api/src/graphql/__tests__/integration/attachments.test.ts`

**Interfaces:**
- Consumes Task 1's store functions.
- List scope: issues the viewer can read (existing issue access SQL), and (includeArchived OR issue not archived).
- `commentBody` → existing `createComment({ parent: { issueId }, body, actorUserId })` after the save.

- [ ] **Step 1: Write the failing tests** (real SDK, raw `gql` for errors):
  - `creates, reads, updates and lists links` — `createAttachment({ issueId, title, url, subtitle, metadata: { n: 1 } })`; `attachment(id)`; `updateAttachment(id, { title })`; `issue.attachments()` and `attachments()` list it; `attachmentsForURL(url)` finds it; `attachmentIssue(id)` returns the issue.
  - `upserts on attachmentCreate and attachmentLinkURL` — same URL twice → one attachment; `attachmentLinkURL({ issueId, url })` on a new URL → title equals URL; on the existing URL → title unchanged.
  - `upserts onto a file by its absolute url` — file row via store; `createAttachment({ issueId, url: <file's GraphQL url>, title: 'Renamed' })` → same id, `sourceType` `upload`; `issue.attachments()` length 1.
  - `adds a comment from commentBody` — issue comments contain the body.
  - `hides attachments from users who cannot see the issue` — outsider: `attachment(id)` ENTITY_NOT_FOUND; `attachments`, `attachmentsForURL` empty.
  - `deletes a link, and a file with its embed` — `deleteAttachment(link)` success; file row whose markdown is in the issue description → after delete the description no longer contains its publicId.
  - `rejects unsupported input and bad urls` — `createAsUser` → INVALID_INPUT naming it; `url: "javascript:alert(1)"` → INVALID_INPUT.
  - `needs work_items.create to attach` — role `{ work_items: { read: true } }` member → FORBIDDEN.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/graphql/__tests__/integration/attachments.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; typecheck 0 errors.
- [ ] **Step 5: Commit** `feat(api): serve attachments over GraphQL`

### Task 3: Filters and docs

**Files:**
- Create: `apps/api/src/graphql/attachment-filter.ts` (`attachmentFilterSql(filter): SQL | undefined`: `id`, `title`, `subtitle`, `url` (eq/neq/in/nin values normalised), `createdAt`, `updatedAt`, `creator`, `sourceType`, `and`, `or`)
- Modify: `apps/api/src/graphql/resolvers/attachment.ts` (use it), `apps/api/src/graphql/issue-filter.ts` (`attachments`: `some`, `every`, `length`, direct fields as `some`), `apps/api/AGENTS.md`, `README.md`, memory `linear-graphql-staged-plan.md`
- Test: extend `apps/api/src/graphql/__tests__/integration/attachments.test.ts`

- [ ] **Step 1: Write the failing tests:**
  - `filters attachments` — by `title: { contains }`, `url: { eq }` with a file's absolute URL, `sourceType: { eq: "upload" }`, `creator: { id: { eq } }`.
  - `filters issues by attachments` — `issues(filter: { attachments: { some: { url: { contains: "github" } } } })` returns only the issue with that link; `attachments: { length: { eq: 0 } }` returns the other.
  - `rejects unknown filter fields` — `attachments(filter: { originalIssue: … })` → INVALID_INPUT.
- [ ] **Step 2: Run** the GraphQL attachments test — Expected: FAIL.
- [ ] **Step 3: Implement**, then docs.
- [ ] **Step 4: Run** — Expected: PASS; root `format:check`, `lint`, `typecheck`, `build`; full API suite green except S3-only tests.
- [ ] **Step 5: Commit** `feat(api): filter attachments and issues by attachments`

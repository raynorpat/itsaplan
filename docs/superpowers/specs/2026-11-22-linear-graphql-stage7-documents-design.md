# Linear-compatible GraphQL API — Stage 7: documents

Follows stages 1–6 (`docs/superpowers/specs/2026-11-2*-linear-graphql-stage*-design.md`).

## Intent

Linear tools and agents list, read, create and edit documents: titled Markdown
pages in a project or on an issue. Stage 7 adds Linear's `Document` and comments on
documents. Standing rule: when unsure, do what Linear does.

## Goals

- Documents in a project or on an issue, with Linear's fields.
- GraphQL queries, relations, filter and mutations listed below.
- Comments on documents through `documentContentId`, as in Linear.
- A `Document` webhook resource type.

## Non-goals

- Web UI, REST routes and MCP tools for documents (GraphQL only, as stages 5–6).
- History entries on the parent issue or project, document comments in the issue
  and project feeds, and mention runs or notifications for document comments (as
  for comments on project updates).
- Documents in initiatives, teams or releases; `Initiative.documents` stays empty
  (Linear's create and update inputs cannot set an initiative either).
- Content history (`documentContentHistory`), workspace sharing
  (`documentUpdateWorkspaceAccess`), templates (`lastAppliedTemplateId`),
  subscribers. Their root fields stay NOT_IMPLEMENTED; input fields for them are
  INVALID_INPUT naming the field; `subscribers` is an empty connection.
- Reactions on documents (Linear has none; reactions on a document's comments work
  through the existing `commentId`).

## Anti-goals

- A document or its comments visible to someone who cannot see its project or
  issue.
- A document with no parent, or with both a project and an issue.

## Approaches

1. **The document's id is also its content id (chosen).** One `document` table;
   `Document.documentContentId` returns the document id; `DocumentContent` is built
   from the document row; `comment.document_id` points at the document. Follows the
   stage 3 and 5 pattern for adding a comment parent.
2. **A separate `document_content` table, as in Linear.** Rejected: two rows to keep
   in sync on every write and an extra join on every read, with no behaviour a
   client can see.

## Data model

The baseline migration is regenerated; the dev database is reset before
`db:migrate`.

### `document`

| column                  | notes                                                      |
| ----------------------- | ---------------------------------------------------------- |
| `id`                    | uuid                                                       |
| `title`                 | text, not empty                                            |
| `content`               | text, nullable (Markdown)                                  |
| `icon`, `color`         | text, nullable                                             |
| `sort_order`            | double, default 0                                          |
| `slug_id`               | 12 hex chars, unique, as `project.slug_id`                 |
| `project_id`            | FK project, cascade, nullable                              |
| `issue_id`              | FK issue, cascade, nullable                                |
| `creator_user_id`       | FK user, set null                                          |
| `updated_by_user_id`    | FK user, set null                                          |
| `owner_user_id`         | FK user, set null                                          |
| `hidden_at`             | timestamptz, nullable                                      |
| `archived_at`           | timestamptz, nullable                                      |
| `trashed`               | boolean, nullable                                          |
| `created_at`, `updated_at` |                                                         |

Check: exactly one of `project_id`, `issue_id`. Indexes on `project_id` and
`issue_id`.

### `comment`

Gains `document_id` (FK document, cascade); the parent check counts it; the
`feed_entry` view carries it.

## Rules

- **Parent:** create needs exactly one of `projectId`, `issueId` (INVALID_INPUT
  otherwise). Update may move the document to another project or issue by setting
  one of them (the other is cleared); setting both is INVALID_INPUT.
- **Delete and restore:** `documentDelete` sets `archived_at` and `trashed = true`
  (Linear's trash); `documentUnarchive` clears both. Both return Linear's
  `DocumentArchivePayload` (`entity`). Archived documents are left out of lists
  unless `includeArchived`; `document(id)` still returns them.
- **Archived parent:** documents whose project or issue is archived are left out of
  lists unless `includeArchived` (Linear archives a project's documents with it).
  Creating a document in, moving it to, or unarchiving it under an archived parent
  is INVALID_INPUT ("restore the parent first", Linear's documentUnarchive rule).
- **Writes** set `updated_by_user_id` to the actor and bump `updated_at`.
- `ownerId` must be a user who can see the document (INVALID_INPUT otherwise).
- `hiddenAt` is stored and returned as given.
- **URL:** the parent's web URL (`/projects/<projectId>` or the issue page) with
  `#document-<slugId>`; the web has no document page yet.

## Access

- A project document is visible through a team of the project that grants
  `projects.read` (existing project access); creating, editing, deleting and
  restoring it need `projects.edit` in such a team.
- An issue document is visible to members of the issue's team; writes need
  `work_items.edit` there.
- Moving a document needs write access to both the old and the new parent.
- Comments on a document follow it: reading needs read access, commenting the same
  read access (as comments on project updates).

## GraphQL

- Queries: `document(id)` (id or slugId), `documents(filter, includeArchived)`.
- `Document` fields from the row plus `documentContentId` (= id), `documentContent`,
  `url`, `creator`, `updatedBy`, `owner`, `project`, `issue`, `comments`,
  `subscribers` (empty), `initiative` (null).
- `DocumentContent`: `id` (= document id), `content`, `document`, `project`,
  `issue`, `createdAt`, `updatedAt`.
- `Project.documents`, `Issue.documents` (visible, unarchived unless
  `includeArchived`).
- `DocumentFilter`: `id`, `title`, `slugId`, `createdAt`, `updatedAt`, `creator`
  (id), `owner` (id, null), `project` (id), `issue` (id), `team` (id: the issue's
  team or one of the project's teams), `and`, `or`. Anything else INVALID_INPUT.
- Mutations: `documentCreate` (`title`, `content`, `icon`, `color`, `sortOrder`,
  `projectId`, `issueId`, `ownerId`, `id`), `documentUpdate` (the same without `id`,
  plus `hiddenAt`; `trashed` is INVALID_INPUT — use delete and unarchive),
  `documentDelete`, `documentUnarchive` (both `DocumentArchivePayload`).
- Comments: `commentCreate` accepts `documentContentId`; `Comment.documentContentId`
  and `Comment.documentContent`; `Document.comments`; `CommentFilter` unchanged.

## Webhooks

`Document`: `create`, `update`, `remove` (delete). Payload follows Linear's
`DocumentWebhookPayload` (`creatorId`, `updatedById`, `projectId`, `subscriberIds:
[]`, …, plus `issueId`, which Linear's payload lacks). Scope: the project's teams,
or the issue's team; a move sends one `update` to the old and the new parent's
teams together (as a project team change does). Comments on documents send the existing
`Comment` events to the same teams.

## Left to the builder

File layout (`apps/api/src/documents/`), the default `sortOrder` for a new document
(after the parent's last document), and the webhook payload builder.

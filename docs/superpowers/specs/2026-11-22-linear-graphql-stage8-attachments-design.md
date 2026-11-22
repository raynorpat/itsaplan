# Linear-compatible GraphQL API — Stage 8: attachments

Follows stages 1–7 (`docs/superpowers/specs/2026-11-2*-linear-graphql-stage*-design.md`).

## Intent

Linear tools and integrations link external things to issues: a pull request, a
support ticket, a thread, any URL. Linear models these as `Attachment`: a titled link
on an issue with a subtitle, an icon and free-form metadata. Files uploaded to an
issue are attachments too. Stage 8 adds Linear's `Attachment` and serves the app's
existing file attachments through it, so a Linear client sees every link and file on
an issue. Standing rule: when unsure, do what Linear does.

## Goals

- Link attachments on issues with Linear's fields, created, updated and deleted over
  GraphQL.
- Existing file attachments appear as `Attachment`s (title = filename, url = the
  public download URL, `sourceType: "upload"`).
- GraphQL queries, relations, filters and mutations listed below.
- An `Attachment` webhook resource type, sent for links and for files.

## Non-goals

- Web UI and MCP tools for links. The web attachments panel and the REST routes keep
  showing and managing files only (API-only, as stages 5–7).
- Integration-specific mutations (`attachmentLinkGitHubPR`, `attachmentLinkSlack`,
  `attachmentLinkJiraIssue`, …, `attachmentSyncToSlack`) and `attachmentSources`:
  they need those services. They stay NOT_IMPLEMENTED.
- URL unfurling (fetching a page title or icon for a link).
- Uploading files over GraphQL (`fileUpload`); files are still uploaded over REST.
- History entries for attachments.

## Anti-goals

- An attachment visible to someone who cannot see its issue.
- A link with a `javascript:` or other non-web URL.
- Two attachments with the same URL on one issue.
- Deleting a file attachment over GraphQL that leaves its stored object or its
  embeds in the description behind.

## Approaches

1. **One `attachment` table for links and files (chosen).** `issue_attachment` is
   renamed and gains Linear's fields; the file columns become nullable and are set
   only for uploads. Matches Linear, where an upload is one source of attachment.
2. **A separate table for links, with files merged in through a view** (as
   `feed_entry` merges comments). Rejected: every GraphQL write would branch on which
   table an id belongs to, and pagination and filters would run over a union.
3. **A separate table where each upload also writes an attachment row.** Rejected:
   two rows to keep in sync on rename and delete, and existing uploads need a
   backfill.

## Data model

The baseline migration is regenerated; the dev database is reset before
`db:migrate`.

### `attachment` (renamed from `issue_attachment`)

| column               | notes                                                         |
| -------------------- | ------------------------------------------------------------- |
| `id`                 | uuid                                                          |
| `issue_id`           | FK issue, cascade                                             |
| `url`                | text, not null                                                |
| `title`              | text, not null, not empty                                     |
| `subtitle`           | text, nullable                                                |
| `icon_url`           | text, nullable                                                |
| `metadata`           | jsonb, not null, default `{}`                                 |
| `source_type`        | text, nullable (`upload` for files)                           |
| `group_by_source`    | boolean, not null, default false                              |
| `creator_user_id`    | FK user, set null                                             |
| `public_id`          | uuid, unique, nullable: files only                            |
| `s3_key`, `filename`, `content_type`, `size_bytes` | nullable: files only            |
| `created_at`, `updated_at` |                                                         |

Check: `s3_key`, `filename`, `content_type`, `size_bytes` and `public_id` are all set
or all null. Unique index on (`issue_id`, `url`). Index on `issue_id`.

An upload stores `url = /attachments/<publicId>/raw` (the path the REST DTO already
returns) and `title = filename`. The GraphQL `url` field and the webhook return it as
an absolute URL on the API origin. Every URL a client sends (create and
`attachmentLinkURL` upserts, `attachmentsForURL`, `eq`/`neq`/`in`/`nin` in the `url`
filter) is normalised first: a URL that starts with the API origin followed by
`/attachments/` loses the origin. A client therefore finds and upserts a file by the
URL it was given, and the stored rows do not depend on the configured origin
(builder's call).

Code that reads the table moves to the new name: `attachments/store.ts` and
`routes.ts`, `issues/store.ts` (issue delete returns the file rows), `shared/s3.ts`
comment, and the worker telemetry query. REST lists, the team quota and storage
totals count only rows with an `s3_key`.

## Rules

- **Create (`attachmentCreate`)**: `issueId`, `title` and `url` are required. If the
  issue already has an attachment with that URL, it is updated with the given fields
  and returned (Linear's upsert); otherwise a new one is created with `creator` set
  to the actor. `url` must be an absolute `http` or `https` URL. `title` is trimmed
  and must not be empty. `metadata` defaults to `{}`.
- **`commentBody`** on create adds a comment with that body to the issue, as the
  actor, after the attachment is saved (Linear's behaviour).
- **Upsert onto a file**: the given fields replace the file row's title, subtitle,
  icon and metadata; `source_type` stays `upload` and the file columns are untouched.
- **`attachmentLinkURL`**: creates or updates a link like `attachmentCreate`. A new
  attachment without `title` gets the URL as its title; on the update path a missing
  `title` keeps the existing one (builder's call).
- Link attachments have `sourceType` null. The upsert path sends an `update` event.
  An issue delete sends only the `Issue` remove event, no per-attachment events.
- **Update (`attachmentUpdate`)**: sets `title`, `subtitle`, `iconUrl`, `metadata`
  (replaced, not merged). The URL and issue cannot change. Works for files too; the
  filename column is left as it was.
- **Delete (`attachmentDelete`)**: removes the row. For a file it also removes the
  stored object and strips its embeds from the issue, as the REST delete does.
- Unsupported inputs (`createAsUser`, `displayIconUrl`, which need an OAuth
  application actor) are INVALID_INPUT naming the field.
- Attachments of archived issues are left out of lists unless `includeArchived`;
  `attachment(id)` still returns them. Writes to them are allowed (as comments).
- A file attachment's REST `id` stays its `public_id`; GraphQL uses `id`.

## Access

The same `work_items` actions the REST attachment routes use, on the issue's team:

- Reading needs read access to the issue.
- Create (and `attachmentLinkURL`, including the upsert path) needs
  `work_items.create`; update needs `work_items.edit`; delete needs
  `work_items.delete`.

## GraphQL

- Queries: `attachment(id)`, `attachments(filter, includeArchived, …)`,
  `attachmentsForURL(url)` (visible attachments with exactly that URL),
  `attachmentIssue(id)` (the attachment's issue).
- `Attachment` fields from the row, plus `issue`, `creator`, `source` (null),
  `originalIssue` (null), `externalUserCreator` (null), `bodyData` (null),
  `archivedAt` (null).
- `Issue.attachments(filter)`.
- `AttachmentFilter`: `id`, `title`, `subtitle`, `url`, `createdAt`, `updatedAt`,
  `creator` (id, null), `sourceType`, `and`, `or`. Anything else INVALID_INPUT.
- `IssueFilter.attachments` (`AttachmentCollectionFilter`): `some`, `every`,
  `length` and the direct fields above.
- Mutations: `attachmentCreate` (`issueId`, `title`, `url`, `subtitle`, `iconUrl`,
  `metadata`, `groupBySource`, `commentBody`, `id`), `attachmentUpdate`,
  `attachmentLinkURL` (`issueId`, `url`, `title`, `id`), `attachmentDelete`.

## Webhooks

`Attachment`: `create`, `update`, `remove`. Payload follows Linear's
`AttachmentWebhookPayload` (`issueId`, `creatorId`, `title`, `subtitle`, `url`,
`metadata`, `source: null`, `sourceType`, `groupBySource`, …). Scope: the issue's
team. File uploads and deletes over REST send `create` and `remove` too. The web's
webhook resource list (`apps/web/src/lib/api.ts`) gains `Attachment`.

## Left to the builder

File layout (likely `apps/api/src/attachments/` for the store, a GraphQL resolver
and filter module), the payload builder, and how the REST routes share the store.

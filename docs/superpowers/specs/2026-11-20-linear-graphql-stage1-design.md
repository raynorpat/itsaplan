# Linear-compatible GraphQL API — Stage 1: issues and workflow states

## Intent

Existing Linear tools and the official `@linear/sdk` must work when pointed at an
It's a Plan instance (`new LinearClient({ apiKey, apiUrl: "https://<host>/graphql" })`).
The work is split into stages by domain. Stage 1 covers issues and workflow states,
plus the minimum of teams, users, the viewer and the organization that those two
need to resolve. Later stages (comments, labels, cycles, Linear projects,
initiatives, webhooks in Linear's format, …) add resolvers to the same schema.

Success for Stage 1: a script using `@linear/sdk` can list teams, list and read a
team's workflow states, create/update/archive states, list issues with
filters and pagination, read one issue by UUID or identifier (`MKT-42`), and
create/update/archive/unarchive/delete issues. All of this runs against an
It's a Plan instance, and the results match what the web app shows.

## Goals

- `POST /graphql` on the api app serves Linear's published schema unmodified.
- Every query document the SDK sends validates against it. This includes the full
  `Issue` fragment (about 90 fields, including cycle, SLA, reactions, shared access).
- Stage 1 resolvers return real data for the issue and workflow-state surface listed
  under "Implemented operations".
- Writes through GraphQL have the same effects as writes through REST: activity
  entries, webhook events, notifications, delegate agent runs, permission checks.
- The data model gains the issue fields Linear has and the SDK commonly writes:
  parent, estimate, status timestamps, and Linear's integer priority.
- Every entity id is a UUID, as in Linear: all app tables and the better-auth
  tables. REST, the web app and MCP use the same UUIDs.

## Non-goals (Stage 1)

- Moving the web app or MCP off REST. REST stays the primary API for both.
- Web UI for sub-issues, estimates, or the new state types beyond rendering them as
  ordinary columns.
- Comments, labels, attachments, relations, cycles, Linear projects, milestones,
  documents, reactions, favorites, customers, SLAs, templates, integrations.
- Linear-format webhooks, OAuth apps, DPoP, Linear's complexity/rate-limit headers.
- The `triage` and `duplicate` state types. Linear reserves both (they cannot be
  created through `workflowStateCreate`), and they belong to features (triage
  intake, duplicate marking) outside Stage 1. `WorkflowState.type` is a `String` in
  the schema, so leaving them out breaks no SDK query.
- Making tools that hardcode `api.linear.app` work. Only clients with a configurable
  API URL are in scope.

## Anti-goals

- A hand-written subset schema. The SDK's own queries would fail validation.
- A second write path that skips the store functions. Any GraphQL write that does
  not produce the same activity/webhook/notification output as REST is a bug.
- Silently returning success for an operation that is not implemented.

## Constraints

- Linear's schema SDL is taken from `packages/sdk/src/schema.graphql` in
  `github.com/linear/linear` and committed to the repo as a vendored file with
  its source commit recorded. It is updated deliberately, never fetched at runtime.
- The SDK requires an HTTPS `apiUrl` unless the host is localhost.
- The SDK sends a personal API key as `Authorization: <key>` (no `Bearer` prefix).
- No existing database has data to keep. The 53 migrations in
  `packages/db/drizzle` are replaced by a single new baseline generated from the
  updated schema. Existing instances, including the reference instance, are reset.
- Repo rules from `AGENTS.md` and `apps/api/AGENTS.md` apply: Bun, Drizzle
  migrations, store functions return DTOs, access is enforced declaratively,
  integration tests against a real test Postgres.

## Approaches considered

1. **Serve Linear's schema unmodified, implement resolvers in stages.** Chosen.
   Every SDK query validates from day one; each later stage only adds resolvers.
   Cost: introspection advertises features that are not implemented yet.
2. **Hand-written subset schema with Linear's names.** Rejected: the SDK's fixed
   fragments select fields the subset lacks, so `client.issue()` fails validation.
3. **Option 1 plus moving web and MCP onto GraphQL now.** Rejected for Stage 1:
   roughly doubles the work and is not needed for SDK compatibility.

## Design

### Endpoint

- graphql-yoga mounted in the api app at `POST /graphql` (GET for introspection
  tooling is acceptable). The schema is built from the vendored SDL with
  `makeExecutableSchema`; resolvers live under `apps/api/src/graphql/`, one file
  per Linear type or domain (`issue.ts`, `workflow-state.ts`, `team.ts`, …).
- The endpoint sits outside the swagger docs and outside the MCP tool generator.

### Authentication

- `Authorization: <api key>` and `Authorization: Bearer <api key>` both resolve
  through better-auth's API key verification to the same user an `x-api-key` header
  would. Session cookies also work, so the endpoint can be tried from a browser.
- No credentials → GraphQL error with `extensions.code: "AUTHENTICATION_ERROR"`
  and HTTP 401, the shape Linear returns.

### Access

- A team (= project) is visible only to its members.
- A user is visible when they share at least one project with the viewer, or are
  the viewer. This matches the REST model, which has no instance-wide user list
  outside the admin-only `/god` routes. `User.assignedIssues` for another user
  returns only issues in projects the viewer can see. Lists filter to the viewer's
  projects; a by-id read of a non-visible entity returns the same "not found" error
  as a missing one.
- Writes check the same permission matrix entries the REST routes use (via the
  `shared/access.ts` primitives); project owners bypass it as in REST.

### Concept mapping

| Linear            | It's a Plan                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| Organization      | One per instance, synthetic. Its id is stored in `app_setting`.         |
| Team              | `project`. `key` = project key, `name`, `description`.                  |
| WorkflowState     | `project_column`. `type` = `state_type`, `position` = `position`.       |
| Issue             | `issue`. `number` = `sequence_number`, `identifier` = `KEY-number`.     |
| User              | better-auth `user`. AI agent bot users included.                        |
| Issue.delegate    | `issue.delegate_user_id`.                                               |
| Issue.priority    | `issue.priority`, integer 0–4 (0 none, 1 urgent, 2 high, 3 medium, 4 low). |
| Issue.sortOrder   | `issue.position`.                                                       |
| Issue.archivedAt  | `issue.archived_at`.                                                    |

### Data model changes (new baseline migration)

- **UUID primary keys everywhere.** Every app table's `id` is
  `uuid PRIMARY KEY DEFAULT gen_random_uuid()`, and every foreign key to it is
  `uuid`. Composite-key tables keep their composite keys over uuid columns.
  better-auth is configured with `advanced.database.generateId: "uuid"`, and
  `bun run auth:generate` regenerates `packages/db/src/schema/auth.ts` with uuid ids.
  GraphQL `id` fields return these ids directly.
- **REST, web and MCP follow.** Route params that use `t.Numeric()` for ids use
  `t.String({ format: 'uuid' })`. Store function signatures, DTOs, the web app's
  types in `apps/web/src/lib/api.ts`, and MCP tool argument schemas change from
  number to string. Public identifiers that are not ids (project key, `KEY-42`,
  share tokens, attachment `publicId`) are unchanged.
- **Integer priority.** `issue.priority` is `integer NOT NULL DEFAULT 0` with a
  check constraint `0..4`. REST, the web app (priority icons, filters, sorting,
  analytics breakdown) and MCP use the same integers. `initiative.priority` is not
  changed in this stage.
- `issue.parent_id` (nullable FK to `issue`, same project, `ON DELETE SET NULL`),
  `issue.estimate` (nullable real), `issue.creator_user_id` (nullable FK to user).
- `issue.started_at`, `completed_at`, `canceled_at` (nullable timestamptz),
  maintained in `createIssue`/`updateIssue` for REST and GraphQL writes alike:
  - Entering a `started` column sets `started_at` if it is null.
  - Entering a `completed` column sets `completed_at`; leaving one clears it.
  - Entering a `canceled` column sets `canceled_at`; leaving one clears it.
  - Entering a `backlog` or `unstarted` column clears all three.
  - Changing a column's `state_type` (REST `updateColumn`) does not move issues and
    does not touch their timestamps.
  `Issue.triagedAt` and `startedTriageAt` resolve to null.
- `project_column.description` (text, default `''`) and `archived_at`
  (nullable timestamptz) for `WorkflowState.description` and `workflowStateArchive`.
  Archive rules, taken from Linear's schema docs:
  - Refused while any non-archived issue is in the column.
  - Refused for the last non-archived column of its type in the project.
  - The existing REST rule "Backlog columns cannot be deleted" does not apply to
    archive; the last-of-type rule covers it.
  - No unarchive (Linear has none).
  - An archived column is hidden from REST `listColumns`, the board and MCP, and
    `createIssue`/`updateIssue` refuse it as a target (REST included). It appears
    in GraphQL only with `includeArchived: true`.
- REST DTOs for issues and columns gain the new fields; web types are updated so
  typecheck passes. No new UI for the new fields.

### Implemented operations

Queries: `viewer`, `organization`, `user`, `users`, `team`, `teams`,
`workflowState`, `workflowStates`, `issue`, `issues`, `searchIssues` (title/
description text match), plus the connection fields `Team.issues`, `Team.states`,
`Team.members`, `WorkflowState.issues`, `Issue.children`, `User.assignedIssues`.

Mutations: `issueCreate`, `issueUpdate`, `issueArchive`, `issueUnarchive`,
`issueDelete`, `issueBatchUpdate`, `workflowStateCreate`, `workflowStateUpdate`,
`workflowStateArchive`.

- `issueBatchUpdate` accepts 1–50 issue UUIDs across any teams the viewer can
  edit. It calls `updateIssue` per issue and is not atomic, unlike Linear's; the
  permission check runs per issue before any write, so a forbidden id fails the
  whole call before anything changes.
- `issue(id:)` and `team(id:)` accept a UUID, or an identifier (`MKT-42`) / team key.
- `issueCreate` requires `teamId` and `title`. `stateId` defaults to the same column REST
  picks. `parentId`,
  `estimate`, `assigneeId`, `delegateId`, `priority`, `dueDate`, `description`,
  `sortOrder` are honored. Other input fields that are not implemented
  (`cycleId`, `projectId`, `labelIds`, …) return an error that names the field,
  not a silent ignore.
- `issueDelete` in Linear moves the issue to trash. It's a Plan has no trash, so
  it deletes the issue; `trashed` is always `false`.
- Mutation payloads follow Linear's shape: `{ success, lastSyncId, issue }`.
  `lastSyncId` is an increasing number (the current time in milliseconds).

### Pagination, filtering, ordering

- Relay connections: `first`/`after`/`last`/`before`, `nodes`, `edges`, `pageInfo`.
  Default page size 50, maximum 250, as in Linear. Cursors are opaque.
- `orderBy`: `createdAt` and `updatedAt` (Linear's `PaginationOrderBy`).
- `includeArchived` defaults to `false`.
- `IssueFilter` supports: `id`, `number`, `title`, `description`, `priority`,
  `estimate`, `createdAt`, `updatedAt`, `completedAt`, `dueDate`, `team` (`id`,
  `key`), `state` (`id`, `name`, `type`), `assignee` (`id`, `email`, `isMe`),
  `delegate` (`id`), `parent` (`id`, `null`), `and`, `or`, with the matching
  comparators (`eq`, `neq`, `in`, `nin`, `null`, `lt`/`lte`/`gt`/`gte`,
  `contains`/`containsIgnoreCase`/`startsWith`). `WorkflowStateFilter` supports `id`,
  `name`, `type`, `team`. Any other filter key returns an error naming it.

### Fields and operations not implemented in Stage 1

- Nullable object fields (`cycle`, `project`, `projectMilestone`, `favorite`, …)
  resolve to `null`. List and connection fields resolve to empty. Non-null scalars
  resolve to the neutral value (`customerTicketCount: 0`, `reactionData: {}`,
  `previousIdentifiers: []`, `labelIds: []`, `trashed: false`).
- Non-null object fields on unimplemented types (`Issue.sharedAccess`, …) resolve to
  a minimal valid object.
- Every query or mutation root field without a resolver returns a GraphQL error
  with `extensions.code: "NOT_IMPLEMENTED"` and the field name. A default field
  resolver produces this; it is not written per field.

### Errors

GraphQL errors use Linear's `extensions` shape (`code`, `userPresentableMessage`).
Store-level `HttpError`s are translated: 400 → `INVALID_INPUT`, 403 → `FORBIDDEN`,
404 → `ENTITY_NOT_FOUND`, 409 → `CONFLICT`.

### Testing

- Integration tests in `apps/api/src/graphql/__tests__/integration/` that drive the
  in-memory app with `@linear/sdk` itself (custom `fetch` into `app.handle`) as a
  dev dependency. They cover the success scenario above, the access rules (non-member
  sees nothing, cannot write), filters, pagination boundaries (250/251), identifier
  lookup, and one REST-vs-GraphQL parity case per write (same activity and webhook
  output).
- A unit test validates every document in the SDK's `_generated_documents` against
  the served schema, so a schema update that breaks SDK queries fails CI.

## Calls made by the designer (check these)

- Users are visible only to people who share a project with them (see Access).
  The alternative, every account on the instance, would expose all emails to any
  API key holder.
- `initiative.priority` stays text until the stage that covers initiatives.
- All tables move to UUID ids in this stage, so later stages do not change the same
  foreign keys again.
- `triage` and `duplicate` state types are deferred to the stage that adds triage.
- Status timestamps follow the rules in "Data model changes", for REST writes too.
- `workflowStateArchive` follows Linear's rules and hides the column everywhere.
- `issueBatchUpdate` is not atomic.
- One synthetic organization per instance, because the app has no workspace level
  yet. A later stage that adds workspaces replaces it.
- `issueDelete` hard-deletes.
- Issue relations are not in Stage 1. `Issue.relations` returns empty.

## Left to the builder

- graphql-yoga integration details with Elysia and how the request user is passed
  into the resolver context.
- Cursor encoding, and the SQL that translates filters.
- How the "not implemented" default resolver is installed.
- Which minimal object satisfies each non-null field on unimplemented types.
- Splitting the work into slices and their order. The UUID and baseline change
  touches most of the codebase and should land, with REST/web/MCP tests green,
  before the GraphQL work starts.

# Linear-compatible GraphQL API — Stage 3: comments, reactions and labels

Follows stage 1 (`2026-11-20-linear-graphql-stage1-design.md`), stage 2
(`2026-11-21-linear-graphql-stage2-projects-design.md`) and the webhooks design
(`2026-11-21-linear-webhooks-design.md`).

## Intent

Linear tools and `@linear/sdk` work against a self-hosted instance. Stage 3 brings
comments, reactions and labels to Linear's model and serves them over `/graphql`:
comments that can be edited, deleted, replied to and resolved, on issues, projects
and project updates; emoji reactions; workspace labels, label groups as labels, and
retired labels. Standing rule: when unsure, do what Linear does.

## Goals

- A `comment` table shaped like Linear's Comment; comments leave `issue_activity`.
- Comment create, update, delete, resolve and unresolve over GraphQL, with the
  same store functions as REST.
- Replies one level deep; resolving a root thread.
- A `reaction` table for emoji reactions on comments, issues and project updates.
- Labels in Linear's shape: workspace labels (no team), groups as labels, retire and
  restore. The `label_group` table goes away.
- GraphQL queries, relations and mutations for Comment, Reaction and IssueLabel.
- Webhooks: Comment `update` and `remove`; Reaction events; IssueLabel events for
  workspace labels.

## Non-goals

- New web UI: editing, deleting, replying, resolving, reactions, and managing
  workspace labels are API-only in this stage.
- Attachments, documents, initiatives, Slack-synced or external threads, inline
  comments that quote text (`quotedText`), comments on documents or initiatives.
- Label inheritance between teams (`inheritedFrom`), sub-team labels.
- Comment-created issues (`createdIssues`), `botActor`, `onBehalfOf`, `agentSession`
  fields beyond neutral values.

## Anti-goals

- A comment visible to someone who cannot see its issue or project.
- The web app showing a stale or deleted comment, or hiding a label a script applied.
- A label usable on a team's issue when it belongs to another team.

## Approaches

1. **A separate `comment` table (chosen).** Comments get their own table shaped like
   Linear's Comment. The issue and project feeds read change-log entries from
   `issue_activity` and comments from `comment` and merge them by time. Labels: groups
   move into `label`. Reactions: a `reaction` table. Costs a two-table feed and moving
   every comment write path; matches Linear's model, so GraphQL and later stages need
   no translation.
2. **Keep comments in `issue_activity`.** Rejected: one table would hold two kinds of
   rows, every change-log query would skip comment columns and every comment query
   would skip change-log rows, and deleting a comment would delete a change-log row.
3. **Keep `label_group` and translate groups in GraphQL.** Rejected: the same
   half-alignment rejected for the stage 2 renames.

## Data model

The baseline migration is regenerated (no data to keep); the dev database is reset
before `db:migrate`.

### `comment`

| column                    | notes                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| `id`                      | uuid                                                                |
| `issue_id`                | FK issue, cascade, nullable                                         |
| `project_id`              | FK project, cascade, nullable                                       |
| `project_update_id`       | FK project_update, cascade, nullable                                |
| `parent_id`               | FK comment, cascade, nullable — the root of the thread              |
| `user_id`                 | FK user, set null — the author                                      |
| `user_name`               | text — the author's name at write time (as `actor_name` today)      |
| `body`                    | text, Markdown                                                      |
| `edited_at`               | timestamptz, nullable                                               |
| `resolved_at`             | timestamptz, nullable — root comments only                          |
| `resolving_user_id`       | FK user, set null, nullable                                         |
| `resolving_comment_id`    | FK comment, set null, nullable — a reply of the same thread         |
| `created_at`, `updated_at`|                                                                     |

Check: exactly one of `issue_id`, `project_id`, `project_update_id` is set. A reply
has the same parent entity as its root, and its root has no parent (one level). A
reply to a reply is stored under that reply's root (Linear). Index on each parent
column plus `created_at, id`.

`issue_activity` keeps change-log rows only: its `kind` and `body` columns go, and
existing comment-reading code moves to `comment`.

### `reaction`

| column              | notes                                                   |
| ------------------- | ------------------------------------------------------- |
| `id`                | uuid                                                    |
| `comment_id`        | FK comment, cascade, nullable                           |
| `issue_id`          | FK issue, cascade, nullable                             |
| `project_update_id` | FK project_update, cascade, nullable                    |
| `user_id`           | FK user, cascade                                        |
| `emoji`             | text — normalized name, such as `+1`                    |
| `created_at`        |                                                         |

Check: exactly one parent set. Unique (parent, user, emoji) — a user reacts once
with each emoji on an item (Linear).

### `label`

`label` gains: `team_id` nullable (null = workspace label), `parent_id` (FK label,
set null — the group), `is_group` boolean, `description` text nullable,
`retired_at` timestamptz nullable, `creator_user_id` FK user set null. `group_id`
and the `label_group` table are removed. Rules:

- A group cannot be applied to an issue and cannot have a parent; groups do not nest.
- A label's group belongs to the same team, or both are workspace-level.
- Names are unique per team among active labels, and workspace label names are
  unique among workspace labels (case-insensitive, as today's team rule).
- A retired label stays on the issues that have it, cannot be newly applied, and is
  hidden from pickers; restoring clears `retired_at`.
- Deleting a group ungroups its labels (as today).

An issue may carry its own team's labels and workspace labels.

## Access

- **Comments on an issue:** readable by whoever can read the issue (team
  membership). Creating and replying need `work_items.create` on the
  issue's team (today's REST comment route). Editing: the author only. Deleting: the
  author, or an owner of the issue's team.
- **Comments on a project or project update:** readable through a team that grants
  `projects.read` (stage 2 rule); creating needs the same; edit/delete as above, with
  "owner of one of the project's teams" for delete.
- **Resolve/unresolve:** anyone who can read the thread. `resolvingCommentId` must be
  a reply of that thread.
- **Reactions:** add — anyone who can read the item (issue: team membership;
  project update: a team granting `projects.read`; comment: whoever can read the
  comment); remove — the user who added it.
- **Emoji:** stored as given after trimming, 1–64 characters, no mapping between
  forms (`+1` and 👍 are different values). Uniqueness is per exact value.
- **Workspace labels:** read by any team member; create, update, retire, restore and
  delete by any user who is a member of at least one team (same rule as project
  labels). Team labels keep the team's `labels` permission.
- Over MCP the existing gates apply (team `mcp_enabled`).

## GraphQL

- **Queries:** `comment(id)`, `comments(filter)` (filter: `issue`, `project`,
  `projectUpdate`, `user`, `parent`, `createdAt`, `updatedAt`, `body`), `Issue.comments`,
  `Project.comments`, `ProjectUpdate.comments`, `Comment.children`, `Comment.parent`,
  `Comment.user`, `Comment.issue`, `Comment.project`, `Comment.projectUpdate`,
  `Comment.reactions`, `Comment.reactionData`, `Comment.resolvingUser`,
  `Comment.resolvingComment`; `reaction`-less root lists are not in Linear, so reactions
  are read through their parent (`Issue.reactions`, `ProjectUpdate.reactions`,
  `Comment.reactions`). `issueLabel(id)`, `issueLabels(filter)` (filter: `id`, `name`,
  `team` incl. `null`, `isGroup`, `parent`), `Team.labels`, `Issue.labels`,
  `IssueLabel.team`, `IssueLabel.parent`, `IssueLabel.children`, `IssueLabel.creator`,
  `IssueLabel.issues`.
- **Mutations:** `commentCreate` (`body`, `issueId` | `projectId` | `projectUpdateId`,
  `parentId`, `id`), `commentUpdate` (`body`), `commentDelete`, `commentResolve`
  (`id`, `resolvingCommentId`), `commentUnresolve`; `reactionCreate` (`emoji`,
  `commentId` | `issueId` | `projectUpdateId`, `id`), `reactionDelete`;
  `issueLabelCreate` (`name`, `color`, `description`, `teamId`, `parentId`, `isGroup`,
  `id`), `issueLabelUpdate`, `issueLabelDelete`, `issueLabelRetire`,
  `issueLabelRestore`. `issueCreate` / `issueUpdate` accept `labelIds` (and
  `addedLabelIds` / `removedLabelIds` in update), validated against the rules above.
  Other input fields → INVALID_INPUT naming the field, as elsewhere.
- Unimplemented fields keep resolving to neutral values (stage 1 rule).

## REST, MCP and agents

- The existing REST comment route writes to `comment`; mentions, notifications,
  agent mention runs and webhooks keep working. Comments and replies on issues
  created over GraphQL trigger the same mention and notification handling. Editing
  a comment notifies and starts agent runs only for users newly mentioned by the
  edit (Linear). Comments on projects and project updates send webhooks but no
  notifications or agent runs in this stage: notifications and agent runs are
  issue-scoped (`notification.issue_id`, one team per run), and extending them is a
  schema change for the stage that brings project comments to the web app.
  `notification` and `agent_run` rows that come from a comment point at the
  `comment` row (their `source_activity_id` becomes a comment reference).
- The project feed shows the project's own change log, comments on the project,
  comments on its project updates (with replies), and the change log and comments
  of its issues the viewer can see (as today).
- The issue feed (`GET /issues/:id/feed`, the range variant, the share page) and the
  project feed merge `issue_activity` change-log rows and `comment` rows by
  `(created_at, id)`, with the same cursor format. A deleted comment disappears from
  the feed; an edited one shows its current body and an edited flag.
- Labels REST routes work over the new `label` table; the team detail's
  `labelGroups` field is built from group labels, so the web keeps working.
  The team detail's `labels` list also includes workspace labels (`teamId: null`)
  and retired labels (`retiredAt` set). Web pickers offer only the team's active
  labels; when saving an issue's labels they keep every label already on the issue
  that the picker does not offer, so a workspace or retired label applied by a
  script is never dropped by a web edit. REST `labelIds` stays a full replace.
- The agent `add_comment` tool and every other comment writer go through the new
  store function.

## Webhooks

- Comment: `create`, `update` (body, edit, resolve/unresolve), `remove`. Data from
  `toComment`, extended with `parentId`, `projectId`, `projectUpdateId`,
  `resolvedAt`, `resolvingUserId`, `resolvingCommentId`, `editedAt`.
- Reaction: `create` and `remove` on the parent's teams (Linear sends Reaction data
  change events).
- IssueLabel: workspace labels go to all-teams webhooks; team labels to that team's
  webhooks and all-teams webhooks. `toIssueLabel` reads the new columns
  (`toLabelGroupAsIssueLabel` goes away).
- Webhook resource types add `Reaction`.

## Web (minimum, no new features)

- The issue feed shows comments from the new table, replies in time order without
  threading, the current body of an edited comment, and no deleted comments.
- Workspace labels on an issue are shown read-only; label pickers and settings stay
  team-only.
- Settings → Labels keeps managing team labels and groups (groups now stored as
  labels).

## Testing

- API integration tests per route/resolver (stage 1 rules), through the SDK for
  GraphQL: comment CRUD, replies (including a reply to a reply landing under the root),
  resolve with and without a resolving reply, edit/delete permissions, comments on
  projects and project updates and their visibility, reactions (once per emoji per
  user, remove own only), workspace labels (apply to two teams' issues, cannot apply
  another team's label, retired cannot be applied but stays), groups (cannot apply,
  cannot nest), feed merge order and cursor paging across both tables, webhooks for
  each event.

## Left to the builder

- The exact SQL for the merged feed (UNION ALL vs. two queries merged in JS), as
  long as ordering and cursors match today's contract.
- File layout: a `comments/` and a `reactions/` feature folder in `apps/api/src`,
  following the per-feature `routes.ts` + `store.ts` pattern where routes exist.

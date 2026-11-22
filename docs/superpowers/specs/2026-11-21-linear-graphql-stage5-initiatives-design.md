# Linear-compatible GraphQL API — Stage 5: initiatives

Follows stages 1–4 (`2026-11-20-linear-graphql-stage1-design.md`,
`2026-11-21-linear-graphql-stage2-projects-design.md`,
`2026-11-21-linear-graphql-stage3-comments-labels-design.md`,
`2026-11-21-linear-graphql-stage4-cycles-design.md`) and the webhooks design
(`2026-11-21-linear-webhooks-design.md`).

## Intent

Linear tools and `@linear/sdk` work against a self-hosted instance. Stage 5 adds
Linear's initiatives: workspace-level goals that group projects, nest into
sub-initiatives, and report health through their own status updates. Standing
rule: when unsure, do what Linear does.

## Goals

- Initiatives with Linear's fields: name, description, content, status, owner,
  lead team, priority, target date with resolution, color, icon, sort orders.
- Linking projects to initiatives (`InitiativeToProject`, many-to-many).
- Sub-initiatives (`InitiativeRelation`, one parent per initiative).
- Initiative updates with health; `Initiative.health`, `healthUpdatedAt` and
  `lastUpdate` come from the newest update.
- Comments and reactions on initiative updates.
- GraphQL queries, relations, filters and mutations listed below.
- Webhooks: `Initiative` and `InitiativeUpdate` resource types.

## Non-goals

- Web UI. API only in this stage.
- Initiative labels (`initiativeAddLabel`, `initiativeLabel*`), documents, links,
  the history log, update reminders and their settings, project-snapshot diffs
  on updates (`diff`, `diffMarkdown` are null), notifications for initiatives.
  Root fields for these stay NOT_IMPLEMENTED; non-null fields return empty
  values (`labelIds: []`, empty connections for `labels`, `documents`, `links`,
  `history`).
- REST routes for initiatives.

## Anti-goals

- A loop in the initiative hierarchy, or an initiative with two parents.
- An initiative or its updates visible to a user outside its lead team.
- `Initiative.projects` returning a project the caller cannot see.
- The same project linked twice to one initiative.

## Approaches

1. **Separate initiative tables next to the project ones (chosen).**
   `initiative`, `initiative_to_project`, `initiative_relation`,
   `initiative_update`; `comment` and `reaction` gain `initiative_update_id`.
   Matches how stage 3 attached comments and reactions to project updates and
   leaves project code untouched; costs some near-duplicate update code.
2. **One shared update table for projects and initiatives.** Rejected: it
   rewrites working stage 2–3 code, the parent reference becomes polymorphic, and
   Linear keeps the two update types separate with different fields.

## Data model

The baseline migration is regenerated (no data to keep); the dev database is reset
before `db:migrate`.

### `initiative`

| column                    | notes                                                               |
| ------------------------- | ------------------------------------------------------------------- |
| `id`                      | uuid                                                                |
| `name`                    | text, not empty                                                     |
| `description`, `content`  | text, nullable (Linear returns null when unset)                     |
| `color`, `icon`           | text, nullable                                                      |
| `status`                  | `Proposed`, `Planned`, `Active`, `Completed`, `Canceled`; default `Active` |
| `owner_user_id`           | FK user, set null                                                   |
| `creator_user_id`         | FK user, set null                                                   |
| `lead_team_id`            | FK team, set null                                                   |
| `priority`                | 0–4, default 0                                                      |
| `sort_order`, `priority_sort_order` | double, default 0                                         |
| `target_date`             | date, nullable                                                      |
| `target_date_resolution`  | `month`, `quarter`, `halfYear`, `year`, nullable                    |
| `started_at`              | set when status becomes `Active`, kept when it leaves               |
| `completed_at`            | set when status becomes `Completed`, cleared when it leaves         |
| `slug_id`                 | 12 hex chars, unique, as `project.slug_id`                          |
| `archived_at`             | timestamptz, nullable                                               |
| `trashed`                 | boolean, nullable                                                   |
| `created_at`, `updated_at`|                                                                     |

### `initiative_to_project`

`id`, `initiative_id` (FK cascade), `project_id` (FK cascade), `sort_order`
(double), timestamps. Unique (`initiative_id`, `project_id`).

### `initiative_relation`

`id`, `initiative_id` (the parent, FK cascade), `related_initiative_id` (the
child, FK cascade, unique), `sort_order` (double), `user_id` (FK set null),
timestamps. Check `initiative_id <> related_initiative_id`.

### `initiative_update`

As `project_update` (`initiative_id`, `user_id`, `body`, `health` with the same
check, `edited_at`, timestamps) plus `archived_at`. Index (`initiative_id`,
`created_at desc`).

### `comment`, `reaction`, `feed_entry`

`comment.initiative_update_id` and `reaction.initiative_update_id` (FK cascade);
both parent checks count the new column. The `feed_entry` view carries the new
comment column alongside `project_update_id`.

## Rules

- **Status timestamps.** Entering `Active` sets `started_at` to now; entering
  `Completed` sets `completed_at` to now; leaving `Completed` clears it. Creating
  with a status applies the same rule.
- **Archive and delete.** `initiativeArchive` sets `archived_at`;
  `initiativeDelete` sets `archived_at` and `trashed = true` (Linear moves it to
  the trash); `initiativeUnarchive` clears both. Links, relations and updates are
  kept. Archived initiatives are left out of lists unless `includeArchived`.
- **Sub-initiatives.** A child has one parent (INVALID_INPUT when it already has
  one). A relation that would create a loop, or a hierarchy deeper than 5 levels
  counting the top initiative, is INVALID_INPUT. Parent and child may have
  different lead teams.
- **Project links.** Linking an already-linked project is INVALID_INPUT. A project
  may be linked to several initiatives, including an initiative and its ancestor.
- **`Initiative.projects`** includes projects of all descendant initiatives unless
  `includeSubInitiatives: false`, without duplicates, filtered to projects the
  caller can see and by the `filter` argument. The walk does not enter
  descendants the caller cannot see, so a hidden sub-initiative's projects do not
  appear through a visible parent. `subInitiatives` lists only visible children.
- **Hierarchy checks** (loop, second parent, depth) look at the whole tree,
  including initiatives the caller cannot see; the INVALID_INPUT message names
  no hidden initiative. (Builder's call: correctness of the tree outweighs the
  small leak that a hidden relation exists.)
- **Health.** `health`, `healthUpdatedAt` and `lastUpdate` come from the newest
  non-archived update; null when there is none. Updates default to `onTrack` when
  `health` is omitted (as project updates). `isStale` is false.
- **Updates.** `initiativeUpdateCreate`, `initiativeUpdateUpdate` (sets
  `edited_at`), `initiativeUpdateArchive`, `initiativeUpdateUnarchive`.
- **Derived fields.** `visibility` is `public` without a lead team and `private`
  with one (team content here is visible to team members only). `url` and the
  update `url` follow the project URL pattern. `frequencyResolution` is `weekly`;
  reminder fields are null.

## Access

The workspace has no roles of its own, so initiative access is derived from team
membership and the `projects` permission resource:

- **See:** an initiative without a lead team is visible to every user who holds
  `projects.read` in at least one team; one with a lead team is visible to users
  holding `projects.read` in that team (the same helper as project access,
  `teamsGranting`). Updates, their comments and reactions, and relations follow the
  initiative. A relation or link is listed only when both ends are visible to the
  caller.
- **Create, edit, archive, delete, link, relate, post updates:** for a workspace
  initiative, the caller holds `projects.<action>` in at least one team; for a
  lead-team initiative, in the lead team. Setting or changing `leadTeamId`
  requires membership in the new lead team. Linking a project also needs that
  project to be visible to the caller.
- `ownerId` must be a user who can see the initiative (INVALID_INPUT otherwise).
  Changing `leadTeamId` so that the current owner could no longer see the
  initiative is INVALID_INPUT unless the same call clears or replaces the owner
  (Linear: the owner must be able to access the lead team).
- Over MCP only teams with MCP enabled count, as for projects.
- Deleting a team clears `lead_team_id` on the initiatives it leads (FK set
  null); they become workspace initiatives, visible to every user with
  `projects.read` in some team.

## GraphQL

- Queries: `initiative(id)` (id or slug), `initiatives(filter, sort,
  includeArchived)`, `initiativeToProject(id)`, `initiativeToProjects`,
  `initiativeRelation(id)`, `initiativeRelations`, `initiativeUpdate(id)`,
  `initiativeUpdates(filter)`.
- `Initiative` relations: `owner`, `creator`, `leadTeam`, `parentInitiative`,
  `subInitiatives`, `projects`, `initiativeUpdates`, `lastUpdate`,
  `organization`. `Project.initiatives`, `Project.initiativeToProjects`.
  `InitiativeUpdate.comments`, `commentCount`, `reactions`, `reactionData`,
  `initiative`, `user`. `Comment.initiativeUpdate`, `Reaction.initiativeUpdate`.
- `InitiativeFilter`: `id`, `name`, `slugId`, `status`, `health`, `priority`,
  `owner`, `creator`, `leadTeam`, `targetDate`, `startedAt`, `completedAt`,
  `createdAt`, `updatedAt`, `and`, `or`. `ProjectFilter.initiatives`: `some`,
  `every`, `length` with the same fields. `InitiativeUpdateFilter`: `id`,
  `initiative`, `user`, `createdAt`, `updatedAt`, `and`, `or`. Every other filter
  field is INVALID_INPUT naming it, as in earlier stages.
- Mutations: `initiativeCreate`, `initiativeUpdate`, `initiativeArchive`,
  `initiativeUnarchive`, `initiativeDelete`, `initiativeToProjectCreate`,
  `initiativeToProjectUpdate`, `initiativeToProjectDelete`,
  `initiativeRelationCreate`, `initiativeRelationUpdate`,
  `initiativeRelationDelete`, the four update mutations above. `commentCreate`
  accepts `initiativeUpdateId`; `reactionCreate` accepts `initiativeUpdateId`.
  Input fields outside this stage (`labelIds`, reminder fields, `trashed` on
  update, `isDiffHidden`) are INVALID_INPUT naming the field, except
  `labelIds: []`, which is accepted as a no-op.
- `sort` arguments (`initiatives`, `Initiative.projects`,
  `Initiative.subInitiatives`) are INVALID_INPUT naming the argument; ordering
  follows `orderBy` (`createdAt` / `updatedAt`) like every other connection here.
  (Builder's call: no connection supports `sort` yet, and a general sort cursor
  is a separate piece of work.)

## Webhooks

- `Initiative`: `create`, `update`, `remove` (archive and delete). The payload
  follows Linear's `InitiativeWebhookPayload`, including `projects`,
  `parentInitiative` and `subInitiatives` as child payloads, so linking or
  unlinking a project or adding or removing a relation changes the data and sends
  an `update` for each initiative involved (`emitEvent` drops updates with no
  changed field).
- `InitiativeUpdate`: `create`, `update`, `remove` (archive).
- Comments and reactions on initiative updates send the existing `Comment` and
  `Reaction` events.
- Scope: events of a lead-team initiative go to that team's webhooks and to
  all-teams webhooks; events of a workspace initiative go to all-teams webhooks
  only (`emitEvent` with no team ids). When the lead team changes, the `update`
  goes to the new lead team's webhooks and all-teams webhooks (Builder's call).

## Testing

API integration tests (stage rules), covering: create with defaults and status
timestamps; archive, delete and unarchive; visibility by lead team, including a
non-member getting null or FORBIDDEN; linking projects and the hidden-project
filter on `Initiative.projects`; sub-initiative loop, second parent and depth
rejected; `projects` with and without sub-initiatives; health from the newest
update; comments and reactions on an update; filters; webhooks for both types.

## Left to the builder

- File layout (`apps/api/src/initiatives/`), how much of the project update code
  is shared with initiative updates, and the webhook payload builders.
- Sort order defaults for new links and relations (after the last one, as
  project milestones).

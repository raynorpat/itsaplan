# Linear-compatible GraphQL API — Stage 2: teams, projects and project items

## Intent

Stage 1 made issues and workflow states work through Linear's GraphQL API at
`/graphql`, so `@linear/sdk` and Linear tools can be pointed at an It's a Plan
instance. Stage 2 adds Linear's **Project**: a body of work that can span several
teams, with a status, lead, dates, priority, labels, milestones and updates.

The app already has a close equivalent, the initiative, but it belongs to one
project, and "project" in this app means what Linear calls a team. Stage 2 adopts
Linear's vocabulary everywhere: today's `project` becomes `team` and `initiative`
becomes `project`, in the database, REST, MCP, the web app and its routes. The name
`initiative` is then free for Linear's Initiative (a group of projects) in a later
stage.

Linear-format webhooks are a separate follow-on sub-project with its own design.

When a question comes up that this document does not settle, follow what Linear does
(its schema documentation in `apps/api/src/graphql/schema.graphql`).

## Goals

- One vocabulary across every layer: team (Linear Team), project (Linear Project),
  workflow state (Linear WorkflowState).
- A project belongs to one or more teams. Its issues must belong to one of them.
- The web app has a workspace-level Projects area at `/projects`, above the teams,
  listing every project the user can see, filterable by team.
- GraphQL: `project`, `projects`, `Team.projects`, `Issue.project`,
  `Issue.projectMilestone`, `projectCreate/Update/Archive/Unarchive/Delete`,
  `projectStatuses`, project milestones, project updates and project labels (queries
  and create/update/delete), and `projectId` / `projectMilestoneId` on
  `issueCreate` / `issueUpdate`.
- Every SDK operation keeps validating against the vendored schema; the depth limit
  and all stage 1 behaviour stay.

## Non-goals (stage 2)

- Web UI for creating or editing milestones and project updates. The app shows
  them read-only: the latest update's health on a project, the milestone name on an
  issue. Editing is GraphQL-only in this stage.
- Custom project statuses. A fixed set of six statuses is seeded;
  `projectStatusCreate/Update/Archive/Unarchive` stay `NOT_IMPLEMENTED`.
- Linear Initiatives, project relations, project members beyond the lead, project
  templates, documents, customer needs.
- Linear-format webhooks (next sub-project).

## Anti-goals

- Two words for one concept in different layers (for example `project` in the
  database meaning a team while the UI says "team").
- A second write path for projects that skips the store functions, activity and
  permission checks.

## Constraints

- No data to keep. The branch's baseline migration is regenerated from the renamed
  schema (it has not been released).
- Breaking REST and MCP renames are allowed (pre-1.0).
- Repo rules from `AGENTS.md` and `apps/api/AGENTS.md` apply, including the web
  structure rules in `apps/web/AGENTS.md`.

## Approaches considered

1. **Full rename to Linear's vocabulary in every layer.** Chosen. Every layer matches
   GraphQL with no translation, and `initiative` is free for Linear's Initiative.
   Cost: a broad rename, comparable to stage 1's UUID change.
2. **Rename only in the UI**, keeping `project` = team and `initiative` = project in
   code with a mapping in GraphQL. Rejected: every later stage carries the mismatch,
   and Linear's Initiative would need another internal name.
3. **Keep the names and call Linear Projects something new** ("roadmap projects").
   Rejected: does not match Linear, and "project" stays ambiguous in the app.

## Design

### Rename (every layer)

| Today | Becomes |
| --- | --- |
| table `project` (key, name, …) | `team` |
| `project_member`, `project_role`, `project_invite`, `project_setting`, `project_notification_setting`, `project_view`, `project_dashboard`, `project_action` | `team_member`, `team_role`, `team_invite`, `team_setting`, `team_notification_setting`, `team_view`, `team_dashboard`, `team_action` |
| `project_column` | `workflow_state` |
| every `project_id` column that points at today's `project` | `team_id` |
| `project.next_sequence`, `mcp_enabled`, `*_enabled` flags | kept on `team`; `initiatives_enabled` → `projects_enabled` |
| `initiative` | `project` |
| `initiative_label` | `project_label_link` (see Project labels) |
| `issue.initiative_id`, `issue_activity.initiative_id` | `project_id` |
| `issue.column_id` | `state_id` |
| permission resource `initiatives` | `projects` |
| REST `/projects/:projectKey/...` | `/teams/:teamKey/...` |
| REST `/initiatives/...` | `/projects/...` |
| REST column routes `/columns` | `/states` |
| MCP tools `*_project*`, `*_initiative*`, `*_column` | `*_team*`, `*_project*`, `*_state` |
| web routes `/project/[projectKey]/...` | `/team/[teamKey]/...` |
| web per-team initiatives pages | removed; replaced by `/projects` |
| UI text "Project" (team) / "Initiative" / "Column"/"State" | "Team" / "Project" / "State" |

Store functions, DTO fields, types, file and folder names follow the same mapping
(`apps/api/src/projects/` → `teams/`, `initiatives/` → `projects/`, `columns/` →
`states/`; web `features/initiatives` → `features/projects`). The GraphQL layer then
maps names one to one.

### Data model (after the rename)

- `project`: `id`, `name` (from `title`), `description` (short plain-text summary,
  default `''`), `content` (Markdown overview, from today's description), `color`
  (nullable hex), `icon` (nullable), `status_id` (FK `project_status`), `lead_user_id`
  (from `owner_user_id`), `priority` (`integer NOT NULL DEFAULT 0`, check 0..4),
  `start_date`, `target_date`, `sort_order` (from `position`), `slug_id` (12 lowercase
  hex chars, unique, generated), `archived_at`, `created_at`, `updated_at`,
  `creator_user_id`.
- `project_team`: (`project_id`, `team_id`) composite key, both `ON DELETE CASCADE`.
  A project has at least one team.
- `project_status`: `id`, `name`, `type` (`backlog | planned | started | paused |
  completed | canceled`), `color`, `position`, `description`, `indefinite`,
  `created_at`. Seeded in the baseline with fixed UUIDs, one per type, named as
  Linear's defaults: Backlog, Planned, In Progress, Paused, Completed, Canceled. New
  projects default to Backlog.
- `project_milestone`: `id`, `project_id` (cascade), `name`, `description`,
  `target_date`, `sort_order`, `created_at`, `updated_at`, `archived_at`.
- `project_update`: `id`, `project_id` (cascade), `user_id` (author, set null),
  `body` (Markdown), `health` (`onTrack | atRisk | offTrack`), `created_at`,
  `updated_at`, `edited_at`.
- `project_label`: workspace level: `id`, `name`, `color`, `description`,
  `parent_id` (group, nullable), `is_group`, `created_at`, `updated_at`,
  `retired_at`. Unique `name` among siblings.
- `project_label_link`: (`project_id`, `label_id`).
- `issue.project_id` (nullable FK, set null), `issue.project_milestone_id`
  (nullable FK `project_milestone`, set null).

### Rules

- **Issue ↔ project:** an issue's project must include the issue's team
  (`INVALID_INPUT` / REST 400 otherwise). Its milestone must belong to its project.
  Changing or clearing the project clears the milestone.
- **Removing a team from a project** is refused (409 / `CONFLICT`) while any issue of
  that team is in the project. The last team cannot be removed.
- **Deleting a team** deletes the projects whose only team it was (with their
  milestones, updates and label links); projects shared with other teams just lose
  the link. Done in `deleteTeam`'s transaction.
- **Moving an issue to another team** (not possible today; issues stay in their team)
  is out of scope.
- **Health:** GraphQL `Project.health` is the latest update's health, or null when
  the project has no update (Linear's behaviour). The web app shows that health,
  falling back to today's computed indicator (`initiatives/health.ts`) when there is
  no update, so existing projects keep a signal.
- **Progress** stays computed from the issues' state types, as today.
- **Archive:** `projectArchive` sets `archived_at`; archived projects are hidden from
  lists unless `includeArchived`. `projectDelete` deletes (no trash); issues keep
  existing with `project_id` cleared by the FK.

### Access

- A project is visible to a user who is a member of any of its teams and whose role
  there grants `projects` `read` (owners always pass). Its milestones, updates and
  labels follow the project; its issues are listed only when the viewer can see the
  issue's own team.
- `Project.teams`, the REST DTO's `teams` and the web teams field list only the teams
  the viewer is a member of (Linear: "teams associated with this project that you
  can access"). Progress, computed health and issue counts are computed over all of
  the project's issues.
- `teamIds` on `projectUpdate` and `PUT /projects/:id/teams` replace the viewer's
  accessible teams only; teams the viewer cannot see are kept unchanged.
- `projects_enabled = false` on a team hides that team from the Projects area's team
  filter and its sidebar link; the API ignores it (Linear has no such switch).
- MCP: a project route is reachable over MCP when at least one of the project's
  teams that grants the caller the needed permission has `mcp_enabled`; the
  permission check uses only those teams.
- Lead: must be a member of at least one of the project's teams at the time it is
  set. Removing a team later does not change the lead.
- Edit (update, archive, team changes, milestones, labels on it) needs the
  `projects` `edit` permission in at least one of its teams; owners of any of its
  teams pass. Delete needs `projects` `delete` in at least one team.
- Create needs `projects` `create` in every team listed, so a user cannot attach a
  team they lack rights in. Adding a team to an existing project needs `projects`
  `edit` in that team too.
- Project updates: any member of one of the project's teams may post; the author may
  edit or delete their own update; `projects` `edit` may delete any.
- Project labels are workspace-level: any user who is a member of at least one team
  may create, update or delete them (Linear's default, without the admin-only
  restriction).

### REST

The renamed initiative routes become project routes scoped by project id, not by
team: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:projectId`,
`POST /projects/:projectId/archive|unarchive`, `PUT /projects/:projectId/teams`,
`GET /projects/:projectId/feed` (the initiative feed), plus
`GET/POST/PATCH/DELETE /project-labels`. `GET /projects` accepts `teamKey`, `status`
(type), `includeArchived`, and the existing sort/pagination of the initiatives list.
REST does not expose milestone or update writes in this stage (GraphQL only); the
project DTO carries `health` (latest update) and `computedHealth`.

### GraphQL

- Queries: `project(id)` (UUID or `slugId`), `projects(filter, …)`,
  `projectStatuses`, `projectMilestone(id)`, `projectMilestones`,
  `projectUpdate(id)`, `projectUpdates`, `projectLabel(id)`, `projectLabels`;
  connection fields `Team.projects`, `Project.teams`, `Project.issues`,
  `Project.projectMilestones`, `Project.projectUpdates`, `Project.labels`,
  `ProjectMilestone.issues`; relations `Issue.project`, `Issue.projectMilestone`,
  `Project.status`, `Project.lead`, `Project.creator`, `ProjectUpdate.project`,
  `ProjectUpdate.user`, `ProjectMilestone.project`.
- Mutations: `projectCreate` (`name`, `teamIds`, `description`, `content`, `color`,
  `icon`, `leadId`, `statusId`, `priority`, `startDate`, `targetDate`, `sortOrder`,
  `labelIds`), `projectUpdate` (same minus nothing required; `teamIds` replaces the
  team list), `projectArchive`, `projectUnarchive`, `projectDelete`,
  `projectMilestoneCreate/Update/Delete`, `projectUpdateCreate/Update/Delete`,
  `projectLabelCreate/Update/Delete`. Other input fields → `INVALID_INPUT` naming
  them. `issueCreate` / `issueUpdate` gain `projectId` and `projectMilestoneId`.
- `ProjectFilter`: `id`, `name`, `slugId`, `status` (`id`, `name`, `type`),
  `lead` (as the user filter), `priority`, `startDate`, `targetDate`, `createdAt`,
  `updatedAt`, `accessibleTeams` / `team` (by id or key), `and`, `or`.
  `IssueFilter` gains `project` (`id`, `name`, `null`) and `projectMilestone`
  (`id`, `null`).
- `Project.url` = first `APP_URL` + `/projects/<id>`; `slugId` is the stored
  12-hex id; `state` (deprecated string) = status type.
- Unimplemented project fields keep resolving to neutral values (stage 1 rule).

### Web

- **Navigation:** the main sidebar gets a "Projects" entry above the team list,
  linking to `/projects`. Team pages move to `/team/[teamKey]/...`.
- **`/projects`:** the renamed initiatives list (status tabs, sort, pagination,
  progress and health columns) across all visible projects, with a team filter and a
  "Create project" dialog that picks one or more teams.
- **`/projects/[projectId]`:** the renamed initiative detail page (overview,
  issues board, activity feed, timeline). Adds: a teams field (add/remove with the
  rules above), status from the six statuses, priority (0–4, the shared priority
  picker on the integer scale), project labels picker, latest-update health,
  read-only milestone list.
- **`/projects/settings/labels`:** list, create, rename, recolor and delete project
  labels.
- **Issues:** the project field on an issue offers projects that include the
  issue's team; the issue shows its milestone name read-only.
- Priority: with initiatives gone, the web priority UI moves to the integer scale
  everywhere and `priorityKey` / `priorityLevel` are removed.

### Testing

- Existing suites follow the rename and keep passing.
- Integration tests for the project rules (team membership of issues, removing a
  team, milestone/project consistency, visibility across teams, permissions per
  team) through REST and GraphQL.
- GraphQL tests drive the SDK: `createProject`, `project.teams()`,
  `team.projects()`, `issue.project`, milestones, updates (health),
  labels, archive/unarchive/delete, filters, `NOT_IMPLEMENTED` on project status
  mutations.
- The SDK document and depth-limit unit tests stay green.

## Calls made by the designer (check these)

- Workflow-state table renamed to `workflow_state` and `issue.column_id` to
  `state_id`, matching Linear, alongside the team/project rename.
- Six fixed project statuses seeded; status CRUD not implemented.
- Project lead counts as the project's only member (`Project.members` returns the
  lead); full membership is later.
- Removing a team with issues in the project is refused rather than unlinking them.
- Project labels: any team member may manage them.
- Project URLs use the id, not Linear's `slug-slugId` path.
- Today's initiative description becomes `content`; `description` starts empty.

## Left to the builder

- Order of the rename (DB, API, worker/bot, MCP, web) and how to keep the suite
  green between slices.
- Component split for the new web pages within `apps/web/AGENTS.md` rules.
- Query shapes for cross-team project lists and progress/health computation.

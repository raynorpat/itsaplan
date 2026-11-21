# Linear-compatible GraphQL API, Stage 2 (teams and projects) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app to Linear's vocabulary (team, project, workflow state) and add multi-team Linear Projects with statuses, milestones, updates and workspace-level labels, over REST, a workspace-level web Projects area, and `/graphql`.

**Architecture:** A mechanical rename lands first in three slices (schema, API side, web), each leaving the suite green. Project behaviour is then added to the renamed `projects/` store and routes. The GraphQL layer comes last and calls the same store functions, as in stage 1.

**Tech Stack:** Bun (`/opt/homebrew/bin/bun`), Elysia, Drizzle + PostgreSQL, better-auth, graphql-yoga, Next.js App Router + shadcn, `@linear/sdk@103.0.0` (tests).

**Spec:** `docs/superpowers/specs/2026-11-21-linear-graphql-stage2-projects-design.md`

## Global Constraints

- Commit per task, Conventional Commit subject, no trailer or metadata (user instruction).
- Rename mapping exactly as the spec's Rename table, in every layer: `project`→`team`, `project_<x>`→`team_<x>`, `project_column`→`workflow_state`, `project_id` (team FK)→`team_id`, `initiative`→`project`, `initiative_id`→`project_id`, `issue.column_id`→`state_id`, permission `initiatives`→`projects`, REST `/projects/:projectKey`→`/teams/:teamKey`, `/initiatives`→`/projects`, `/columns`→`/states`, web `/project/[projectKey]`→`/team/[teamKey]`.
- Project statuses: six seeded rows with fixed UUIDs, types `backlog | planned | started | paused | completed | canceled`, names Backlog, Planned, In Progress, Paused, Completed, Canceled; new projects default to Backlog.
- Project priority `integer NOT NULL DEFAULT 0` check 0..4. Update health `onTrack | atRisk | offTrack`. `slug_id` 12 lowercase hex chars.
- Milestone and update writes are GraphQL-only; web shows them read-only.
- The baseline migration is regenerated (unreleased); the storage-settings seed stays appended, and the six status rows are appended too.
- Where this plan and the spec are silent, do what Linear does (schema docs in `apps/api/src/graphql/schema.graphql`).

## Review Focus

- An issue put in a project that does not include the issue's team → REST 400 / GraphQL `INVALID_INPUT`. → Task 4 test.
- Removing a team from a project while that team's issues are in it → 409 / `CONFLICT`; removing the last team → 409. → Task 4 test.
- A viewer in only one of a project's two teams sees only that team in `teams`, and replacing `teamIds` keeps the hidden team. → Task 4 (REST) and Task 9 (GraphQL) tests.
- Deleting a team that is a project's only team deletes the project; a project shared with another team survives without the link. → Task 4 test.
- An issue given a milestone of another project → 400 / `INVALID_INPUT`; changing an issue's project clears its milestone. → Task 6 and Task 9 tests.

---

### Task 1: Schema — rename and project tables, regenerated baseline

**Files:** `packages/db/src/schema/app.ts`, `packages/db/drizzle/*` (regenerate), `packages/db/src/index.ts` if exports change.

**Produces:** Drizzle exports renamed per the mapping (`team`, `teamMember`, `teamRole`, `teamInvite`, `teamSetting`, `teamNotificationSetting`, `teamView`, `teamDashboard`, `teamAction`, `workflowState`, `project`, `projectLabelLink`), columns `teamId`, `projectId`, `stateId`, `team.projectsEnabled`; new tables `projectTeam`, `projectStatus`, `projectMilestone`, `projectUpdate`, `projectLabel`; `issue.projectMilestoneId`; `project` columns per the spec's Data model. Exported constant `PROJECT_STATUS_IDS: Record<'backlog'|'planned'|'started'|'paused'|'completed'|'canceled', string>` in `packages/db/src/project-statuses.ts`, used by the seed SQL and the API.

- [ ] Rename in the schema; add the new tables and columns; drop `initiative.project_id` (replaced by `project_team`) and the old initiative label table.
- [ ] Delete `packages/db/drizzle/*`, `bun run db:generate`, append the storage seed and an `INSERT INTO project_status` of the six rows using `PROJECT_STATUS_IDS`.
- [ ] Recreate dev and test databases; `bun run db:migrate && bun run db:migrate:test`. Expected: success.
- [ ] `bun --filter='@repo/db' run typecheck`. Expected: pass.
- [ ] Commit `feat(db)!: rename to teams, workflow states and projects; add project tables`.

### Task 2: API, worker, bot, MCP follow the rename

**Files:** move `apps/api/src/projects/`→`teams/`, `initiatives/`→`projects/`, `columns/`→`states/`; every api/worker/bot/agent-tools file using the renamed names; MCP tool names; `shared/permissions.ts` (`projects` resource); tests follow; GraphQL resolvers read the new names (`team` table etc.).

**Produces:** REST routes per the mapping. The project store keeps today's single-team behaviour in this task: `createProject(teamId, input, actor)` inserts one `project_team` row; reads join `project_team`. Status text is mapped onto `status_id` (proposed→backlog, planned→planned, active→started, completed→completed, canceled→canceled). Priority on projects becomes integer here. MCP tool names: `list_teams`, `get_team`, `create_team`, `update_team`, `delete_team`, `copy_team`, `get_team_*`, `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `list_project_activity`, `*_state` for columns.

- [ ] Rename folders, identifiers, routes, DTO fields (`teamId`, `teamKey`, `stateId`, `projectId`), MCP tools and instruction text, permission resource.
- [ ] Update tests; `bun run typecheck` (api, worker, bot, agent-tools) and the api suite. Expected: green apart from the S3-dependent tests.
- [ ] Commit `refactor!: rename projects to teams and initiatives to projects in the api`.

### Task 3: Web follows the rename

**Files:** `apps/web/src/app/project/[projectKey]`→`app/team/[teamKey]`; `features/initiatives`→`features/projects` (moved, still team-scoped in this task at `/team/[teamKey]/projects`); `lib/api.ts`, `utils/paths.ts`, services, components using renamed fields; UI copy "Project"→"Team", "Initiative"→"Project", "Column"→"State". Project priority now integer: remove `priorityKey`/`priorityLevel` and move the shared priority UI to the integer scale.

- [ ] Rename routes, paths, types, copy; priority UI on integers.
- [ ] `bun run typecheck && bun run lint && bun run build` for web. Expected: pass.
- [ ] Run API + web; sign up, create a team, an issue and a project; load `/team/<KEY>` and the project page. Expected: 200, no errors.
- [ ] Commit `refactor(web)!: use teams, projects and states`.

### Task 4: Multi-team projects in REST (teams, access, rules)

**Files:** `apps/api/src/projects/{store,routes}.ts`, `apps/api/src/teams/store.ts` (`deleteTeam`), `apps/api/src/issues/store.ts` (project check), access helpers in `apps/api/src/shared/access.ts`; tests `apps/api/src/projects/__tests__/integration/projects.test.ts`.

**Produces:**
- `visibleProjectIds(userId): SQL subquery` — projects with a team where the user is a member and `projects.read` passes (owners pass).
- `assertProjectPermission(projectId, user, action, opts?: { mcp?: boolean }): Promise<string[]>` returns the team ids granting the action; throws 403 when none; with `mcp`, only teams with `mcp_enabled` count.
- Routes: `GET /projects?teamKey&status&includeArchived&…`, `POST /projects` (body `teamIds: string[]` min 1), `GET/PATCH/DELETE /projects/:projectId`, `PUT /projects/:projectId/teams` (body `teamIds`), `GET /projects/:projectId/feed`.
- `setProjectTeams(projectId, viewer, teamIds)` replaces only the viewer's accessible teams.
- DTO `teams` lists accessible teams only.

- [ ] **Tests:** create with two teams (permission needed in both: 403 when missing in one); member of team A only lists the project and sees `teams` = [A]; non-member 404; `PUT teams` from a viewer who sees only A keeps B; removing a team with issues in the project → 409; removing the last team → 409; adding a team needs `projects.edit` there; an issue of team C put into a project of A/B → 400 (Review Focus); deleting the only team deletes the project, deleting one of two keeps it (Review Focus); lead must be a member of one of the teams → 400 otherwise; a role with `projects.read=false` in all the project's teams → not listed.
- [ ] Run; expect failures. Implement. Run the suite; expect green.
- [ ] Commit `feat(api): projects span teams`.

### Task 5: Project fields, statuses, archive, labels (REST)

**Files:** `apps/api/src/projects/{store,routes}.ts`, create `apps/api/src/project-labels/{store,routes}.ts`; tests in each folder.

**Produces:** project DTO fields `name, description, content, color, icon, statusId, status {id,name,type,color}, leadUserId, priority, startDate, targetDate, sortOrder, slugId, archivedAt, labelIds, health, computedHealth`; `GET /project-statuses`; `POST /projects/:id/archive|unarchive`; project labels `GET/POST /project-labels`, `PATCH/DELETE /project-labels/:labelId` (any member of at least one team), groups via `parentId`/`isGroup`, a group cannot be applied, unique name among siblings → 409.

- [ ] **Tests:** default status Backlog; status change; priority 5 → 400; slugId is 12 hex and unique; archive hides from list unless `includeArchived`, unarchive restores; label CRUD, duplicate sibling name → 409, applying a group → 400; a user in no team cannot create a label → 403.
- [ ] Run, implement, run.
- [ ] Commit `feat(api): project statuses, labels and archive`.

### Task 6: Milestones, updates, health (store)

**Files:** create `apps/api/src/projects/milestones.ts`, `apps/api/src/projects/updates.ts`; `apps/api/src/issues/store.ts` (`projectMilestoneId` rules); tests `apps/api/src/projects/__tests__/integration/milestones-updates.test.ts` driving the store functions through REST project reads (milestone writes have no REST route — the tests call the store functions directly with a REST-created project).

**Produces:** `createMilestone(projectId, input, actor)`, `updateMilestone(id, patch)`, `deleteMilestone(id)`, `listMilestones(projectId)`; `createUpdate(projectId, userId, { body, health })`, `updateUpdate(id, patch)`, `deleteUpdate(id)`, `listUpdates(projectId)`; project DTO `health` = latest update's health or null; `computedHealth` from `projects/health.ts`. Issue: `IssuePatch.projectMilestoneId`, `NewIssueInput.projectMilestoneId`; a milestone of another project → 400 (Review Focus); changing/clearing `projectId` clears the milestone (Review Focus).

- [ ] Tests, run (fail), implement, run (pass).
- [ ] Commit `feat(api): project milestones and updates`.

### Task 7: Web — workspace Projects area

**Files:** `apps/web/src/app/projects/page.tsx`, `app/projects/[projectId]/page.tsx`, `app/projects/settings/labels/page.tsx`; `features/projects/**` (list with team filter, create dialog with team multi-select, detail with teams field, status, priority, labels picker, health, read-only milestones); `components/layout/SidebarMainNav.tsx` ("Projects" entry above teams); remove the per-team projects route and nav item; issue project field limited to projects of the issue's team; issue milestone name read-only.

- [ ] Implement; `bun run typecheck && bun run lint && bun run build`. Expected: pass.
- [ ] Run API + web; create a project across two teams, open `/projects` and the project page, filter by team, add a label in settings. Expected: pages 200, the project lists under both teams.
- [ ] Commit `feat(web): workspace projects area`.

### Task 8: GraphQL queries

**Files:** create `apps/api/src/graphql/resolvers/project.ts`, `apps/api/src/graphql/project-filter.ts`; extend `issue-filter.ts`, `resolvers/issue.ts` (`Issue.project`, `Issue.projectMilestone`), `resolvers/team.ts` (`Team.projects`), `mount.ts`; tests `apps/api/src/graphql/__tests__/integration/projects-query.test.ts`.

**Produces:** queries and connection fields listed in the spec's GraphQL section; `toProject(row)`, `findProject(idOrSlugId, userId)`; `ProjectFilter` fields per spec; `IssueFilter.project` and `.projectMilestone`.

- [ ] **Tests (SDK):** `client.project(id)` full fragment, `client.project(slugId)`; `project.teams()` accessible only (Review Focus); `team.projects()`; `projects({ filter: { status: { type: { eq: "started" } } } })`; `issue.project`, `issue.projectMilestone`; `project.projectMilestones()`, `project.projectUpdates()` with health; `project.health` from latest update; `projectStatuses` returns six; `projectLabels`; non-member → `ENTITY_NOT_FOUND`.
- [ ] Run, implement, run.
- [ ] Commit `feat(api): add GraphQL project queries`.

### Task 9: GraphQL mutations

**Files:** extend `apps/api/src/graphql/resolvers/mutations.ts` (or split `project-mutations.ts` if it passes ~300 lines); tests `apps/api/src/graphql/__tests__/integration/projects-mutations.test.ts`.

**Produces:** `projectCreate/Update/Archive/Unarchive/Delete`, `projectMilestoneCreate/Update/Delete`, `projectUpdateCreate/Update/Delete`, `projectLabelCreate/Update/Delete`; `issueCreate`/`issueUpdate` accept `projectId`, `projectMilestoneId`. Unsupported input → `INVALID_INPUT` naming it. `projectStatusCreate` stays `NOT_IMPLEMENTED`.

- [ ] **Tests (SDK):** `createProject({ name, teamIds })`; `updateProject(id, { teamIds })` from a one-team viewer keeps the hidden team (Review Focus); team removal with issues → `CONFLICT`; `createProjectMilestone`, issue with that milestone; milestone of another project → `INVALID_INPUT` (Review Focus); `createProjectUpdate({ projectId, body, health: 'atRisk' })` then `project.health === 'atRisk'`; author-only edit of an update → `FORBIDDEN` for another member; labels CRUD; archive/unarchive/delete; `projectStatusCreate` → `NOT_IMPLEMENTED`.
- [ ] Run, implement, run.
- [ ] Commit `feat(api): add GraphQL project mutations`.

### Task 10: Finish

- [ ] `bun run format:check && bun run lint && bun run typecheck && bun run build` and the api suite. Expected: green apart from S3 tests.
- [ ] Update `AGENTS.md` files and README for the new vocabulary (team, project, state) and the Projects area.
- [ ] Run the `tidy` skill, then a fresh whole-branch review; fix Critical/Important with tests first.
- [ ] Commit `docs: describe teams and projects`.

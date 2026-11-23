# Web on GraphQL Stage 5.3 (Projects and Initiatives) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The projects area runs on GraphQL with Linear's tabs (Overview, Updates, Issues, Documents) and members, and a new Initiatives section exists.

**Architecture:** Task 1 adds project members to the API. Tasks 2–4 move and extend the projects area; Task 5 builds initiatives. The 5.1 comment and document components are reused through their target abstraction; pure logic lives in feature utils with unit tests.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga with Linear's SDL; Next.js 15, React 19, TanStack Query 5, gql.tada; Bun tests (API) and node:test (web).

**Spec:** `docs/superpowers/specs/2026-11-23-web-graphql-stage3-projects-initiatives-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes.
- Project activity = `Project.history` + project comments + updates; linked issues' activity is not mixed in.
- Members: `project_member` (project, user); `memberIds` replaces the list; members must see the project; the lead is not auto-added.
- Status counts by paging ids per status (no `totalCount`).
- Initiatives: comments and reactions on initiative updates only; guests see no initiatives.
- Hide controls the API would refuse (project 2 rules).
- Follow `apps/web/AGENTS.md` and `DESIGN.md`. Incremental migrations. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. `projectUpdate({ memberIds: [someone who cannot see the project] })` → INVALID_INPUT and no change. Test in Task 1.
2. The projects list "Load more" never duplicates or skips a project when one is created between pages. Test in Task 2 (paging helper).
3. Posting an update with a health changes the project's shown health at once and in the list. Test in Task 3 (health derivation helper).
4. Linking a project to an initiative the viewer cannot edit, or a sub-initiative past the depth limit, shows the API's message and changes nothing. Test in Task 5 (mutation error mapping helper or API test).
5. A guest sees no Initiatives entry and gets a not-found page at `/initiatives/[id]`. Checked in Task 5 (nav gating helper test).

---

### Task 1: Project members in the API

**Files:** `packages/db` (`project_member` table, incremental migration), `apps/api/src/projects/store.ts` (members read / replace), `graphql/resolvers/project.ts` (`Project.members` through the request loaders; `memberIds` on `projectCreate` / `projectUpdate`), webhook payload `memberIds`.

- [ ] **Step 1: Write the failing test** `apps/api/src/graphql/__tests__/integration/project-members.test.ts`: create with `memberIds: [a, b]` → `members` a, b; update `memberIds: [b]` → b only; a user who cannot see the project → INVALID_INPUT, unchanged; the lead is not added automatically; the Project webhook payload carries `memberIds`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat(api): project members`

### Task 2: Projects list and project reads on GraphQL

**Files:** `apps/web/src/features/projects/services/*` (list with cursor paging and Load more, filters team / status / search via `name: { containsIgnoreCase }`, status counts by paging ids, project detail query with properties, teams, labels, members, milestones, progress, scope, latest update), list and header components, delete the REST list / counts / get methods no caller uses.

**Interfaces (Produces):** `useProjectsList(filters)`, `useProjectStatusCounts(filters)`, `useProject(id)`, `appendPage(current, page)`.

- [ ] **Step 1: Write the failing tests**: `appendPage` de-duplicates by id and keeps order when a page overlaps; status counts sum across statuses; filter → `ProjectFilter` builder.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the projects list and project reads on GraphQL`

### Task 3: Project page tabs — Overview, Updates, Issues

**Files:** project route tabs; Overview (description editor, properties incl. members picker, milestones CRUD and reorder, latest update, project comments with a project comment target, activity from `Project.history` + comments + updates), Updates tab (post with health and Markdown, edit / delete own, comments and reactions on updates via the 5.1 components with a project-update target), Issues tab on 5.2's board data; writes through `projectUpdate`, `projectMilestoneCreate` / `Update` / `Delete`, `projectUpdateCreate` / `Update` / `Delete`; delete the REST feed / milestone / teams / update methods no caller uses.

- [ ] **Step 1: Write the failing tests**: `projectHealth(project, latestUpdate)` (latest update's health, none without updates), `buildProjectFeed(history, comments, updates)` (time order, entry kinds), milestone reorder `sortOrder` helper.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): project overview, updates and issues on GraphQL`

### Task 4: Project documents, create / edit / delete, project labels

**Files:** Documents tab (5.1 document sheet with a project parent), create / edit dialogs and delete on `projectCreate` / `projectUpdate` / `projectDelete`, project labels settings page on `projectLabels` / `projectLabelCreate` / `Update` / `Delete`; delete the remaining REST project methods (`lib/api.ts` keeps no project method).

- [ ] **Step 1: Write the failing tests** for any pure helper added (e.g. project form → input mapping incl. `teamIds`, `memberIds`, dates).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks; grep `lib/api.ts` for project methods — Expected: PASS and none left.
- [ ] **Step 5: Commit** `feat(web): project documents, project editing and labels on GraphQL`

### Task 5: Initiatives

**Files:** sidebar entry (hidden for guests), `/initiatives` list (status, health, owner, target date, project count; status filter; create), `/initiatives/[initiativeId]` detail (overview and properties incl. lead team, linked projects add / remove, sub-initiatives add / remove, updates with health, comments and reactions on updates; edit, archive, unarchive, delete), `features/initiatives/` with services and utils.

- [ ] **Step 1: Write the failing tests**: `initiativeHealth`, `canSeeInitiatives(role)` (false for guests), mapping the API's depth / permission errors to messages.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; HTTP smoke test against the test DB (API 3100, web 3101): sign in; create a team, a project with members, milestones and an update with health; a project document and comment; an initiative linking the project with a sub-initiative and an update; pages `/projects`, `/projects/<id>` (each tab), `/initiatives`, `/initiatives/<id>` render — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): initiatives`

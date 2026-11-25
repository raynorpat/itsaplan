# Project Relations and Projects Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's project dependencies (API and project page) and a projects timeline with bars, milestones, date dragging, grouping and dependency arrows.

**Architecture:** A `project_relation` table and `projects/relations.ts` store behind Linear's `projectRelation*` operations; a shared `utils/projectRelations.ts` computes anchors and conflicts for the web; the issue timeline's scale, header, zoom and date-drag code move to shared timeline pieces that a new projects timeline uses, with an SVG arrow layer.

**Tech Stack:** Bun, Drizzle/Postgres, graphql-yoga with Linear's SDL, Next.js 15, gql.tada.

**Spec:** `docs/superpowers/specs/2026-11-25-project-relations-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. One migration `0066_*`. Follow the AGENTS.md files and DESIGN.md; web features never import each other; shared timeline pieces live in the shared layer.
- Relation `type` is always `dependency`; anchors `start` | `end` | `milestone`; conflict = blocking anchor date after blocked anchor date; missing dates never conflict.
- The issue timeline behaves exactly as before (its existing tests stay green unchanged).
- Commits: one per task, no trailer or metadata.

## Review Focus

1. A relation where the viewer can see only one of the two projects never appears in `projectRelations`, `Project.relations` / `inverseRelations`, nor as a marker tooltip. Test in Task 1 (API) and Task 5 (marker only when the other project is in the loaded set).
2. Creating A→B, B→C, then C→A is refused as a cycle (also a two-node A→B, B→A). Test in Task 1.
3. Deleting the anchoring milestone removes the relation; archiving a project hides it until unarchived. Test in Task 1.
4. Dragging a bar across a DST change or month end moves both dates by the same number of days (UTC days, as the issue timeline). Test in Task 4.
5. A project in two teams grouped by team appears twice; dragging either copy updates both. Test in Task 4.

---

### Task 1: Project relations in the API

**Files:** `packages/db/src/schema/app.ts` + `0066_*`; `apps/api/src/projects/relations.ts` (new); `apps/api/src/graphql/resolvers/project-relation.ts` (new, registered in `mount.ts`); `apps/api/src/views/` (or wherever `LIST_VIEW_TYPES` lives) adds `projects`; `apps/api/AGENTS.md`; test `apps/api/src/projects/__tests__/integration/relations.test.ts`.

**Interfaces:**
- Produces: `project_relation` (id, type text default 'dependency', project_id → project cascade, project_milestone_id → project_milestone cascade null, anchor_type, related_project_id → project cascade, related_project_milestone_id cascade null, related_anchor_type, user_id → user set null, archived_at, created_at, updated_at; unique on (project_id, anchor_type, coalesce(project_milestone_id), related_project_id, related_anchor_type, coalesce(related_project_milestone_id)); checks: anchor types in set, milestone id set iff anchor is `milestone`, project ≠ related project).
- `createRelation(user, input)`, `updateRelation(user, id, input)`, `deleteRelation(user, id)`, `visibleRelationsSql(userId)` (both projects visible, neither archived/trashed). Cycle check: refuse when the related project already (transitively) blocks the source project, under an advisory lock.
- GraphQL: `projectRelation(id)`, `projectRelations`, `projectRelationCreate/Update/Delete`, `Project.relations`, `Project.inverseRelations`, the `ProjectRelation` fields. Edit right = edit right on the source project.
- `userViewPreferences(viewType: projects)` accepted (layout and timeline grouping stored as other list kinds).

- [ ] **Step 1: Failing tests:** create end→start relation and read it from both sides; milestone anchor requires a milestone of that project (other project's milestone → INVALID_INPUT); duplicate → returns CONFLICT; self → INVALID_INPUT; cycles (Review Focus 2); a member who cannot see the related project's team: ENTITY_NOT_FOUND on create and nothing listed (Review Focus 1); guest → FORBIDDEN on create; milestone delete and project archive (Review Focus 3); `userViewPreferences(projects)` round-trips.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/projects` — Expected: FAIL.
- [ ] **Step 3: Schema**, `bun run db:generate`, `bun run db:migrate:test` (not the dev database), implement.
- [ ] **Step 4: Run** `cd apps/api && bun run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): project relations`

### Task 2: Dependencies on the project page

**Files:** `apps/web/src/utils/projectRelations.ts` (+ test); `apps/web/src/services/projectRelations.service.ts`; `features/projects/components/detail/ProjectDependencies.tsx`, `AddDependencyDialog.tsx`, row component (one per file); the projects table row warning icon (`features/projects/components/list/ProjectRow.tsx`).

**Interfaces:**
- Produces: `anchorDate(project, anchorType, milestoneId): string | null`, `isConflict(relation): boolean`, `anchorLabel(anchorType, milestoneName?): string` ("start", "end", "milestone <name>"), `relationsByProject(relations): Map<string, { blockedBy, blocking }>`; hooks `useProjectRelations(projectId)`, `useCreateProjectRelation()`, `useDeleteProjectRelation()`, `useAllProjectRelations()` (for the list and timeline).
- [ ] **Step 1: Failing tests** for `anchorDate`, `isConflict` (each anchor pair, missing dates false, equal dates false), `anchorLabel`.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement** the section (Blocked by / Blocking, conflict warning, Add dependency, remove; guests read only) and the table's conflict icon.
- [ ] **Step 4: Run** root typecheck, `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): project dependencies`

### Task 3: Shared timeline pieces

**Files:** move the scale, header, zoom, today line and date-drag maths from `components/common/board/timeline/*`, `hooks/useTimelineDrag.ts`, `utils/timeline.ts` into shared pieces (e.g. `components/common/timeline/{TimelineScale,TimelineHeader,TimelineBar}.tsx`, `hooks/useTimelineDateDrag.ts`, `utils/timelineScale.ts`); the issue timeline uses them.

**Interfaces:**
- Produces: `timelineScale({ from, to, zoom }): { dayWidth, xOf(date), dateOf(x), ticks }`, `useTimelineDateDrag({ scale, onChange({ start, end }) , mode: 'move' | 'start' | 'end' })`, `TimelineHeader`, `TimelineBar({ start, end, color, children })`. Group reassignment stays in the issue timeline's own code.
- [ ] **Step 1: Failing tests** for the moved pure functions under their new names (port the existing `utils/timeline` tests and add `dateOf(xOf(d)) === d` and UTC month-end cases).
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement** the move; the issue timeline's existing tests unchanged and green.
- [ ] **Step 4: Run** root typecheck, `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `refactor(web): shared timeline pieces`

### Task 4: Projects timeline

**Files:** `features/projects/components/timeline/*` (view, group row, project row, milestone diamond, No dates section; one component per file); `features/projects/utils/projectTimeline.ts` (+ test); the layout switch in the projects list header; the projects list service loads every matching project for the timeline; preferences through `userViewPreferences(projects)`.

**Interfaces:**
- Produces: `buildProjectTimeline(projects, { grouping: 'none' | 'status' | 'team' | 'lead' | 'initiative' }): { groups: { key, label, rows: { projectId, copyIndex }[] }[], noDates: string[] }`; date writes through `projectUpdate` (startDate / targetDate) and `projectMilestoneUpdate` (targetDate).
- [ ] **Step 1: Failing tests** for `buildProjectTimeline` (each grouping; multi-team project in two groups (Review Focus 5); no-team group; no-dates list; one-date project as a point) and the drag date maths for move/start/end across a month end (Review Focus 4).
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/projects` — Expected: FAIL.
- [ ] **Step 3: Implement** (bars in status colour, health, milestones, drag dates, vertical drag ignored, guests read only, No dates drop gives a start of the drop day and a target 14 days later (builder's call; ledger it)).
- [ ] **Step 4: Run** root typecheck, `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): projects timeline`

### Task 5: Dependency arrows

**Files:** `features/projects/components/timeline/DependencyArrows.tsx`, `DependencyMarker.tsx`; `features/projects/utils/arrows.ts` (+ test).

**Interfaces:**
- Produces: `arrowPaths(relations, positions: Map<projectId, { y, xOf(anchor) }>): { id, d, conflict }[]` (orthogonal path from the blocking anchor to the blocked one, using the top-most copy); `offscreenMarkers(relations, shownIds, loadedIds)` (marker only when the other project is loaded/visible to the viewer).
- [ ] **Step 1: Failing tests** for `arrowPaths` (path endpoints at anchor x; top-most copy chosen; conflict flag) and `offscreenMarkers` (no marker when the other project is unknown to the viewer — Review Focus 1).
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/projects` — Expected: FAIL.
- [ ] **Step 3: Implement** (SVG layer over the timeline; red when in conflict; hover highlights both rows; markers with tooltips).
- [ ] **Step 4: Run** root `bun run format:check && bun run lint && bun run typecheck && bun run build`, `cd apps/web && bun test`, `cd apps/api && bun run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): dependency arrows on the projects timeline`

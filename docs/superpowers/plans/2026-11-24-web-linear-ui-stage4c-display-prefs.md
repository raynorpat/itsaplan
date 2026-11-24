# Web UI like Linear, Stage 4c (Display Preferences on the Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display preferences for team "All issues", project issues, cycle pages and My issues are stored per user and view type on the server, through Linear's `viewPreferences*` and `userViewPreferences`.

**Architecture:** Task 1 extends the API's view preferences (migration, mutations, query). Task 2 moves the team / project / cycle lists from localStorage to one hook on that API. Task 3 gives My issues a Display menu on the same hook and runs the smoke check.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga (Linear's SDL); Next.js 15, React 19, TanStack Query 5, gql.tada; `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (section "Stage 4c")

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migration (next after `0039`).
- View types: `allIssues`, `project`, `cycle`, `myIssues` only; others refused with INVALID_INPUT.
- A user reads and writes only their own records; `organization` type without a saved view is refused.
- Defaults for an unchanged list: List layout, grouped by status (the existing defaults in `utils/viewSettings.ts`).
- Saves are debounced (300 ms) and coalesced; a failed save reverts to the last saved value and shows a toast.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. Two quick changes (layout, then grouping) end with both saved, not only the last one, and no save is lost when the page is left within the debounce window (flush on unmount). Test in Task 2 (coalescing helper merges patches; flush called on unmount).
2. Stored preferences from an older shape (missing or unknown keys, the old `table` / `board` layout names) open with defaults for the missing keys and no crash. Test in Task 2 (`toDisplay(stored)` uses `migrateStore`-style mapping).
3. Two users: one user's change never shows for the other. Test in Task 1.
4. `viewPreferencesCreate` twice for the same user and view type updates the one record rather than failing on the unique index. Test in Task 1.
5. A saved view's own preferences are unaffected by the per-type record and still win on that view. Test in Task 2 (the team list reads the per-type record only on the All tab).

---

### Task 1: API — personal preferences per view type

**Files:** `packages/db/src/schema/app.ts` (`customViewId` nullable; check: `custom_view_id IS NOT NULL OR (type = 'user' AND view_type IN (...))`; unique index on `(user_id, view_type)` where `custom_view_id IS NULL`), migration `0040_*.sql` via `bun run db:generate`, `apps/api/src/graphql/resolvers/custom-view.ts` (create / update accept the new case; create on an existing record updates it), `Query.userViewPreferences(viewType)`.

**Interfaces:** Produces the GraphQL behaviour: `viewPreferencesCreate(input: { type: user, viewType: allIssues|project|cycle|myIssues, preferences })` → `{ success, viewPreferences { id viewType preferences } }`; `userViewPreferences(viewType)` → the viewer's record or null; `viewPreferencesUpdate(id, { preferences })` for the owner only; `viewPreferencesDelete(id)` for the owner only.

- [ ] **Step 1: Failing tests** `apps/api/src/graphql/__tests__/integration/view-preferences.test.ts`: create then read back; second create updates the same id; user B reads null and cannot update or delete A's record (NOT_FOUND or FORBIDDEN as the resolver's existing rules use); `viewType: inbox` → INVALID_INPUT; `type: organization` without customViewId → INVALID_INPUT; existing custom-view preference tests still pass.
- [ ] **Step 2: Run** `cd apps/api && bun --env-file=../../.env.test test src/graphql/__tests__/integration/view-preferences.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**, generate and apply the migration (`bun run db:migrate:test`).
- [ ] **Step 4: Run** the full API suite (object-store tests excepted) and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): personal view preferences per view type`

### Task 2: Web — team, project and cycle lists on the server

**Files:** `apps/web/src/services/listPreferences.service.ts` (query `userViewPreferences`, create / update mutation), `apps/web/src/hooks/useListPreferences.ts`, `apps/web/src/utils/listPreferences.ts`; callers `hooks/useViewEditor.ts` (All tab), `features/projects/components/detail/ProjectIssuesBoard.tsx`, `features/cycles/components/CycleIssuesBoard.tsx`, collapsed swimlanes / groups currently in localStorage (`utils/kanban.ts` and wherever collapsed groups are stored); delete `hooks/useLocalBoardSettings.ts` and the localStorage part of `utils/viewSettings.ts` (keep its pure parsing / defaults).

**Interfaces:** Produces
- `type ListViewType = 'allIssues' | 'project' | 'cycle' | 'myIssues'`
- `toDisplay(stored: unknown): ViewSettings` (defaults for missing keys, old layout names mapped)
- `mergePatch(pending: Partial<ViewSettings> | null, next: Partial<ViewSettings>): Partial<ViewSettings>`
- `useListPreferences(viewType: ListViewType): { settings: ViewSettings; update: (patch: Partial<ViewSettings>) => void; loading: boolean }` (optimistic, 300 ms debounce, flush on unmount, revert + toast on error)

- [ ] **Step 1: Failing tests** `utils/__tests__/listPreferences.test.ts`: `toDisplay(null)` → defaults; `{ layout: 'table' }` → `list`; unknown keys dropped; `mergePatch` keeps both keys of two patches, later value wins for the same key; collapsed groups survive a round trip.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/__tests__/listPreferences.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** and switch the callers; saved views keep their own preferences path.
- [ ] **Step 4: Run** web tests and root checks; `grep -rn "localStorage" apps/web/src` shows no display-settings store left (week start and account preferences remain) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): list display settings on the server`

### Task 3: My issues Display menu and smoke check

**Files:** `features/my-issues/*` (Display menu reusing the board's Display menu components: ordering, grouping, completed issues, display properties; no layout switch beyond List), on `useListPreferences('myIssues')`.

**Interfaces:** Consumes `useListPreferences`, `toDisplay`.

- [ ] **Step 1: Failing tests** for any pure helper added (e.g. My issues grouping / ordering applied to rows that span teams: grouping by status groups by status type across teams).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check (API 3100, web 3101, seed): change the team list to Board grouped by priority, reload in a second Chrome profile signed in as the same user → Board by priority; a project's Issues tab and a cycle page keep their own kind's setting; My issues grouping change persists across reload; a saved view keeps its own layout. Screenshots of each — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): My issues display menu`

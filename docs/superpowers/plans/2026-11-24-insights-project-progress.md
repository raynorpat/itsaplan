# Insights and Project Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects serve real daily progress histories and show a progress chart and list ring; every issue view gets Linear's Insights panel computed in the browser.

**Architecture:** Task 1 is API + worker (project progress with the cycle rule, stored daily history, backfill from issue activity, daily snapshot through an internal route). Task 2 is the project UI on it. Tasks 3–4 build Insights: pure computation and data hooks, then the panel and its placement on every view.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga (Linear's SDL, never edited); worker (Bun); Next.js 15, React 19, TanStack Query 5, gql.tada, Recharts; `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-24-insights-project-progress-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations.
- Project progress / scope / histories use the cycle rule in `apps/api/src/cycles/store.ts` (`cycleProgress`): canceled left out; points when any counted issue has estimate > 0 (unestimated counts 1), else issues; progress = (completed + 0.25 × started) / scope; 0.999 while incomplete.
- History arrays are daily, oldest first, from the project's start date (else creation date) to today; closed (completed / canceled) and trashed projects get no new snapshots.
- Insights: computed in the browser; completed issues of the period fetched only while the panel is open, at most 5,000; settings in localStorage per view key; no fetching while closed.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A project whose issues move between projects during its life: each day counts an issue in the project it belonged to that day. Test in Task 1 (backfill with a project change in the middle).
2. A project started in the future or created today: one-value histories, no negative ranges, no crash in the chart. Test in Task 1 and Task 2.
3. The worker running twice on the same day, or missing a day: no duplicate day, and the missed day is filled (from the previous value or a rebuild). Test in Task 1.
4. Insights on a view with zero issues, with all issues unassigned, or with no completed issues in the period: empty states, no NaN percentiles. Test in Task 3.
5. Time measures with issues lacking `startedAt` (completed straight from unstarted): cycle time excludes them and the panel says how many were left out. Test in Task 3.

---

### Task 1: Project progress and daily history in the API

**Files:** `packages/db` (`project`: history arrays and the date of the last snapshot, as cycles store theirs), `apps/api/src/projects/progress.ts` (`projectProgress(projectId)` with the cycle rule; `rebuildProjectHistory(projectId, today)` from `issue_activity` project and status changes by id; `snapshotProjects(today)`), `apps/api/src/graphql/resolvers/project.ts` (`progress`, `scope` and the five history arrays from the stored history, rebuilding on first need), internal route `POST /internal/projects/snapshot` and the worker job beside the purge, `apps/api/AGENTS.md`, `apps/worker/AGENTS.md`.

**Interfaces:** Produces the GraphQL fields `Project.progress`, `scope`, `scopeHistory`, `completedScopeHistory`, `inProgressScopeHistory`, `issueCountHistory`, `completedIssueCountHistory`; `projectProgress(projectId): Promise<CycleProgress>` (same shape as cycles).

- [ ] **Step 1: Failing tests** `apps/api/src/projects/__tests__/integration/project-progress.test.ts`: progress with estimates / without / with started issues / with canceled; a project started 5 days ago with an issue moved in on day 2 and completed on day 4 → the five arrays day by day; a project created today → one value each; snapshot twice on one day → one day added; snapshot after a missed day → the gap is filled; completed and trashed projects get no snapshot; the last history value equals `progress` / `scope`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite (object-store tests excepted), worker tests, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: project progress history`

### Task 2: Project progress chart and list ring

**Files:** `features/projects/components/detail/ProjectProgressChart.tsx` (Recharts: scope line, in-progress and completed stacked areas, dashed target-date reference line, tooltip; header "Scope 42 · Started 12 (29%) · Completed 18 (43%)" in points or issues), `features/projects/utils/progressChart.ts`, the project query reading the history fields, `ProjectOverview.tsx`; `features/projects/components/list/ProjectRow.tsx` (progress ring with percentage, latest update health).

**Interfaces:** Produces `progressSeries(p: { startDate: string | null; createdAt: string; scopeHistory: number[]; completedScopeHistory: number[]; inProgressScopeHistory: number[] }): { date: string; scope: number; started: number; completed: number }[]` and `progressHeader(p, unit: 'points' | 'issues'): string`.

- [ ] **Step 1: Failing tests** for both helpers (dates aligned from the start date; a one-value history; percentages rounded; "1 issue" vs "issues").
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): project progress chart and list progress`

### Task 3: Insights computation, data and settings

**Files:** `features/insights/utils/{measures.ts, slices.ts, stats.ts, overTime.ts, settings.ts}`, `features/insights/services/insightsIssues.service.ts` (completed issues of the period with the view's filter: `completedAt` within the period, only the needed fields, paged to at most 5,000), `features/insights/hooks/useInsightsData.ts`, `features/insights/hooks/useInsightsSettings.ts` (localStorage per view key).

**Interfaces:** Produces
- `type Measure = 'count' | 'points' | 'cycleTime' | 'leadTime' | 'age'`
- `type SliceField = 'status' | 'assignee' | 'priority' | 'label' | 'project' | 'cycle' | 'creator' | 'team'`
- `type InsightsSettings = { open: boolean; measure: Measure; slice: SliceField; segment: SliceField | null; periodMonths: 1 | 3 | 6 | 12; tab: 'breakdown' | 'overTime' }` (default `{ open: false, measure: 'count', slice: 'status', segment: null, periodMonths: 3, tab: 'breakdown' }`)
- `sliceIssues(issues, field, ctx): { key: string; label: string; issues: InsightIssue[] }[]` (an issue with several labels is in each label's slice; "No label", "Unassigned", "No project", "No cycle" slices)
- `breakdown(issues, settings, ctx): { key; label; value: number; share: number; segments: { key; label; value }[] }[]`
- `timeStats(values: number[]): { median: number; p25: number; p75: number; count: number } | null` (null for no values)
- `timeRows(issues, measure, slice, ctx)`, `weeklyCreatedCompleted(issues, periodMonths, now)`
- `insightsViewKey(view): string` (`allIssues:<teamId>`, `project:<projectId>`, `cycle:<cycleId>`, `myIssues`, `view:<customViewId>`)
- `sliceFilter(field, key): FilterCondition` (for click-through, in the view filter's shape)

- [ ] **Step 1: Failing tests**: count and points breakdown with segments; label multi-membership; empty input → `[]`; `timeStats` on `[]` → null and on 1, 2, 5 values; cycle time leaves out issues without `startedAt` and reports the count; lead time; age for open issues; weekly series across a period with gaps; settings default and parse of stored garbage; `sliceFilter` for each field.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): insights computation and data`

### Task 4: Insights panel on every issue view, and smoke check

**Files:** `features/insights/components/{InsightsPanel.tsx, InsightsControls.tsx, BreakdownChart.tsx, TimeChart.tsx, OverTimeChart.tsx}`, an Insights button in the shared view header (team list, project and cycle issue tabs, My issues, saved views), the panel below the list or board (resizable or fixed height, as DESIGN.md allows), click-through wiring into each view's filter (draft on saved views).

**Interfaces:** Consumes Task 3.

- [ ] **Step 1: Failing tests** for any added pure helper (e.g. the header button's label / pressed state per settings, axis formatting of durations "3.5 d").
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check (test DB, seed with estimates, started / completed issues across past weeks via SQL dates where needed): project Overview chart with a target line; projects list rings; Insights on the team list (count by status, segment by priority), cycle time scatter with a click opening an issue, Over time tab, click-through filter, settings kept after reload; panel closed → no insights request in the network log. Screenshots `<scratchpad>/shots/insights-*.png` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): insights panel`

# Web on GraphQL Stage 5.4 (Cycles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web shows Linear's cycles: team cycle settings, a cycles page per team, a page per cycle with progress and issues, and the cycle as an issue property, all on GraphQL.

**Architecture:** Task 1 adds the cycle settings and the sidebar entry; Task 2 the cycle as an issue property (issue page, board, bulk edit, new-issue dialog); Task 3 the cycles page and the cycle page (current / upcoming from the board cache, past cycles from their own query, chart). Pure logic lives in feature utils with unit tests. No API change is planned.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, gql.tada against Linear's SDL; node:test (web); Bun tests (API, regression only).

**Spec:** `docs/superpowers/specs/2026-11-23-web-graphql-stage4-cycles-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes.
- Team settings on `teamUpdate`: `cyclesEnabled`, `cycleDuration` (1–8 weeks), `cycleStartDay`, `cycleCooldownTime`, `upcomingCycleCount`, `cycleIssueAutoAssignStarted`, `cycleIssueAutoAssignCompleted`; editable only by those who manage the team (project 2).
- No cycle control is shown for a team with cycles off.
- Current and upcoming cycles filter the team board cache; past cycles load `issues(filter: { cycle: { id: { eq } } }, includeArchived: true)`; archived issues read-only; any issue write refreshes cached past-cycle queries.
- Issue writes set `cycleId` through `issueUpdate` / `issueBatchUpdate` / `issueCreate`.
- An unnamed cycle shows as "Cycle N". Dates shown in the viewer's time zone; cycle boundaries come from the API.
- Chart is a small SVG; no new chart library.
- Follow `apps/web/AGENTS.md` and `DESIGN.md`. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A team with cycles off shows no Cycles sidebar entry, no cycle column / filter / picker, and `/team/KEY/cycles` shows an empty state that links to the settings for those who manage the team. Test in Task 1 (`cyclesVisible(team)` helper) and Task 2 (column / filter gating).
2. Moving an issue to another cycle on the board updates the cycle page of both cycles without a reload. Test in Task 3 (`cycleIssues(boardIssues, cycleId)` helper over a patched list).
3. A cycle with no history yet (just started, or upcoming) renders progress 0 and no chart line, not an error. Test in Task 3 (chart points helper with empty arrays).
4. Past cycles "Load more" does not repeat or skip a cycle when the upkeep creates one between pages. Test in Task 3 (reuse `appendPage` semantics: de-duplicate by id).
5. The cycle picker lists only the current and upcoming cycles of the issue's own team and "No cycle"; moving the issue to another team clears the shown cycle the way the API does. Test in Task 2 (`cycleOptions(cycles, now)` helper).

---

### Task 1: Cycle settings and the sidebar entry

**Files:** `apps/web/src/features/settings/components/cycles/*` (new settings section), the team settings route (`app/team/[teamKey]/settings/cycles` or a section on the general page; builder's layout), `services/teams.service.ts` (scaffold selects the team's cycle fields; `useUpdateTeamCycles` on `teamUpdate` patching the scaffold), the sidebar team section (Cycles entry when `cyclesEnabled`), `features/work-items/utils/cycles.ts` or shared `utils/cycles.ts` if Task 2/3 need it (placement rule).

**Interfaces (Produces):** scaffold `team.cycles: { enabled, duration, startDay, cooldown, upcomingCount, autoAssignStarted, autoAssignCompleted }`; `cyclesVisible(team)`; `cycleSettingsInput(form)`.

- [ ] **Step 1: Write the failing tests**: `cycleSettingsInput` maps the form to `TeamUpdateInput` fields (duration bounds 1–8 rejected outside; start day 0–6; cooldown 0–duration); `cyclesVisible` false when disabled.
- [ ] **Step 2: Run** `cd apps/web && bun test src` — Expected: FAIL.
- [ ] **Step 3: Implement.** Hide the form's controls (read-only view) for users who cannot manage the team.
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): team cycle settings and the cycles sidebar entry`

### Task 2: The cycle as an issue property

**Files:** board issue fields (`IssueFields` gains `cycle { id number name startsAt endsAt }`), `toIssue`, the team scaffold or a `useTeamCycles(teamKey)` query (current + upcoming + recent past, enough for pickers and grouping), issue page properties (Cycle picker), board: cycle column in the table, card badge, filter field, group-by-cycle, bulk edit "Cycle" (`issueBatchUpdate` with `cycleId`), new-issue dialog Cycle field (`issueCreate` `cycleId`, preset prop `defaultCycleId`), saved-view filter converter for the cycle condition if the project 4 converter supports it (ledger otherwise).

**Interfaces (Produces):** `useTeamCycles(teamKey) → Cycle[]`; `cycleOptions(cycles, now) → { current?, upcoming[] }`; `cycleLabel(cycle)` ("Cycle N" when unnamed); new-issue dialog prop `defaultCycleId`.

- [ ] **Step 1: Write the failing tests**: `cycleOptions` with a fixed `now` (current = starts ≤ now < ends; upcoming sorted; past excluded); `cycleLabel`; group-by-cycle order (current, upcoming, no cycle last); the filter predicate for a cycle condition; gating off when cycles are disabled.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Edits patch the board cache from the mutation response as in 5.2.
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the cycle as an issue property`

### Task 3: Cycles page and cycle page

**Files:** `app/team/[teamKey]/cycles/page.tsx`, `app/team/[teamKey]/cycles/[number]/page.tsx`, `features/cycles/` (components, services: past cycles paged via `cycles(filter: { team, endsAt: { lt: now } })` or `team.cycles` newest first with Load more; cycle detail by team + number with progress and histories; past-cycle issues query), the chart component (SVG over `scopeHistory` / `completedScopeHistory` / `inProgressScopeHistory`), the cycle page's issues in the existing list and board views (`readOnly` for archived rows), `cycleUpdate` for name and description, "New issue" preset to the cycle, invalidation of past-cycle issue queries after any issue write.

**Interfaces (Consumes):** Task 2's `useTeamCycles`, `cycleLabel`, `defaultCycleId`; 5.2's `useBoardIssues`, `appendPage` (5.3, `features/projects/utils/projectList.ts` — move to shared `utils` if reused, placement rule).

**Interfaces (Produces):** `cycleIssues(boardIssues, cycleId)`, `chartPoints(cycle) → { day, scope, started, completed }[]`, `cycleProgress(cycle)`.

- [ ] **Step 1: Write the failing tests**: `cycleIssues` follows a patched issue between two cycles; `chartPoints` for empty histories (no points) and a 14-day cycle (one point per elapsed day); `cycleProgress` from `progress` and the histories; past-cycles paging de-duplicates by id.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite (output to the scratchpad); HTTP smoke test against the test DB (API 3100, web 3101; port 3000 is taken): sign in by magic link; create a team, turn cycles on via `teamUpdate` (duration 1 week); confirm the upkeep or `cycleCreate` gives a current and upcoming cycle; create issues in the current cycle, move one to the upcoming cycle, archive one; run every query the cycle pages use; fetch `/team/<KEY>/cycles`, `/team/<KEY>/cycles/<n>` for current and a past cycle, `/team/<KEY>/settings` cycles section — 200, no dev-server errors. Stop both servers — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): cycles page and cycle page`

# Team Estimates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-team estimate scales with validation, an estimate picker everywhere, and progress using the team's default estimate.

**Architecture:** Team columns + `teams/estimates.ts` (`estimateScale(team): number[] | null`) used by the issue store's validation and team moves; progress reads each issue's team default; the web gets a shared estimate picker and team settings section.

**Tech Stack:** Bun, Drizzle/Postgres, graphql-yoga with Linear's SDL, Next.js 15, gql.tada.

**Spec:** `docs/superpowers/specs/2026-11-25-estimates-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. One migration `0065_*`. Follow the AGENTS.md files and DESIGN.md. Commits: one per task, no trailer or metadata.
- Scales exactly as the spec lists; new and existing teams `notUsed`; `defaultIssueEstimate` default 1.

## Review Focus

1. A batch update setting an estimate across two teams with different scales refuses the whole batch when any one is invalid (no partial write). Test in Task 1.
2. Moving an issue with estimate 13 from an extended Fibonacci team to a linear team clears it and records the change. Test in Task 1.
3. A workflow automation or import writing an estimate obeys the same validation (imports may carry any number: imported values outside the scale are cleared, not refused). Test in Task 1.
4. A team switched to `notUsed` keeps the values; switching back shows them again. Test in Task 1.
5. A T-shirt team sees "M" for 3 in the chip, picker and issue page. Test in Task 2.

---

### Task 1: Team estimate settings and validation (API)

**Files:** `packages/db/src/schema/app.ts` + `0065_*`; `apps/api/src/teams/estimates.ts` (new); the team store / `teamUpdate` resolver and `Team` fields; `apps/api/src/issues/store.ts` (create, update, batch, team move); imports engine (clear out-of-scale); `apps/api/AGENTS.md`; tests `apps/api/src/teams/__tests__/integration/estimates.test.ts`.

- Produces: `ESTIMATE_SCALES`, `estimateScale(settings): number[] | null` (null = not used), `isValidEstimate(settings, value)`; team columns `issue_estimation_type text default 'notUsed'`, `issue_estimation_extended bool default false`, `issue_estimation_allow_zero bool default false`, `default_issue_estimate real default 1`.
- [ ] **Step 1: Failing tests:** defaults read through `Team`; `teamUpdate` sets each field (invalid type → INVALID_INPUT; a guest → FORBIDDEN); estimate refused while `notUsed`, refused off-scale, accepted on-scale, extended and zero variants; `null` clears; Review Focus 1–4.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/teams src/issues` — Expected: FAIL.
- [ ] **Step 3: Schema**, `bun run db:generate`, `bun run db:migrate:test` (not the dev database), implement.
- [ ] **Step 4: Run** `cd apps/api && bun run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): team estimate scales`

### Task 2: Estimate picker and team settings (web)

**Files:** `apps/web/src/utils/estimates.ts` (+ test: scale per settings, T-shirt labels); a shared `components/common/issue/EstimatePicker.tsx`; issue page property, issue context menu, command palette action; `EstimateBadge` opens the picker (not for guests) and shows T-shirt labels; Estimate display property and ordering hidden for teams with estimates off; team settings → Estimates section (follow the existing team settings sections).

- [ ] **Step 1: Failing tests** for `estimateOptions(settings)` (each type, extended, zero, notUsed → []) and `estimateLabel(settings, value)` (T-shirt 3 → "M"; numbers as numbers).
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `bun run typecheck` and `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): estimate picker and team estimate settings`

### Task 3: Progress uses the team's default estimate

**Files:** `apps/api/src/shared/progress.ts` and its SQL callers (cycles, projects, releases, history builders); tests in the existing progress / cycle / project test files.

- [ ] **Step 1: Failing tests:** a team with `defaultIssueEstimate: 0` and one estimated issue (3) plus one unestimated issue: scope 3, not 4; default 2 gives 5; a project spanning two teams uses each issue's own team default.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/cycles src/projects` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `bun run format:check && bun run lint && bun run typecheck && bun run build`, `cd apps/api && bun run test`, `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): progress uses the team's default estimate`

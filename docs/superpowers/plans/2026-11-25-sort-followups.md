# Sorting Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an issue's estimate in lists and boards, and compute sort values once per row in sorted paging.

**Architecture:** A new `estimate` display property in the web's view settings and property chips; `paginateSorted` wraps the caller's base query and orders and filters on aliased sort values.

**Tech Stack:** Bun, Drizzle/Postgres, graphql-yoga, Next.js 15, gql.tada.

**Spec:** `docs/superpowers/specs/2026-11-25-sort-followups-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. No migration. Follow the AGENTS.md files and DESIGN.md. Commits: one per task, no trailer or metadata.

## Review Focus

1. A team with estimates off never shows the chip, even when a saved view has the toggle on. Test in Task 1.
2. Sorted results and page boundaries are identical before and after the paging change for every existing sort test. Test in Task 2 (existing suites).
3. A cursor from before the change still pages correctly (same cursor format). Test in Task 2.

---

### Task 1: Estimate display property

**Files:** `apps/web/src/utils/viewSettings.ts` (`DisplayProperty` adds `estimate`, default on, menu order after priority), the list row and board card property chips (`components/common/board/...`), an `IssueEstimateChip` component (shared, one per file) reusing the issue page's estimate picker, `utils/viewPreferences.ts` (Linear name `estimate` in `displayProperties`), My issues display; tests in `apps/web/src/utils/__tests__/`.

- [ ] **Step 1: Failing tests:** `estimate` is in the default display properties and the menu order; `visibleProperties(team without estimates)` leaves it out; view preferences round-trip `estimate`.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root typecheck and `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): estimate display property`

### Task 2: Sort values computed once per row

**Files:** `apps/api/src/graphql/sort.ts`, every caller of `paginateSorted` (issues, list sorts, users), a new test `apps/api/src/graphql/__tests__/integration/sort-once.test.ts`.

- [ ] **Step 1: Failing test:** a sort key whose SQL calls a test-only counter (for example a temporary function created in the test that increments a sequence) is evaluated at most once per row per page; the generated SQL orders by aliases.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/graphql/__tests__/integration/sort-once.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement:** `paginateSorted` takes the caller's base query (selected columns + where) and builds `SELECT * FROM (<base> + sort values AS s0..sN, id) q WHERE <keyset on aliases> ORDER BY <aliases> LIMIT n`; cursor format unchanged.
- [ ] **Step 4: Run** `cd apps/api && bun run test` — Expected: PASS, every existing sort and paging test unchanged.
- [ ] **Step 5: Commit** `perf(api): compute sort values once per row`

# Web UI like Linear — Stage 2 (Issue list and board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issues show in Linear's dense List by default, boards use compact cards, the header and Display menu match Linear's, saved views have Views pages, and the list has J / K / X / Enter.

**Architecture:** Task 1 builds the List layout (replacing Table) and makes it the default, with My issues on it. Task 2 restyles board cards, moves tabs / filter / Display into the header and rebuilds the Display menu. Task 3 adds the Views pages and sidebar entries and the list keyboard. Each task ends with headless-Chrome screenshots.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, gql.tada, shadcn/ui, Lucide, dnd-kit (as used today); node:test.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (Stage 2)

## Global Constraints

- No layout, property, filter, grouping, saved-view setting or bulk action available today is lost; saved views and stored display settings using `table` keep working (read as `list`).
- `DESIGN.md`; Lucide; no Linear branding. Follow `apps/web/AGENTS.md` (shared vs feature placement; one component per file).
- Screenshots as in stage 1 (headless Chrome, scratch profile, API 3100 / web 3101 on the seeded test DB; reseed if an API test run reset it; stop servers afterwards). Read each screenshot against the spec before committing.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A saved view or stored display setting from before (layout `table`, its columns, grouping, sort) opens in List with the same fields, grouping and order. Test in Task 1 (settings migration helper).
2. A 500-issue team list stays responsive: rows are virtualised or otherwise bounded, and grouping / sorting is computed once per change. Test in Task 1 (helper cost) and checked by screenshot timing.
3. Drag and drop, multi-select and bulk actions work in List as they did in Table and Board (status / priority / assignee by drag between groups, shift-click range select). Test in Task 1 (move and selection helpers).
4. J / K / X / Enter do not fire while typing or inside dialogs / menus (stage 1's `blocksShortcuts`). Test in Task 3.
5. "Completed issues: past week / month / none" hides the right issues by `completedAt` / `canceledAt`, in List and Board, and saved views keep the choice. Test in Task 2.

---

### Task 1: List layout as default; My issues on it

**Files:** `components/common/board/list/*` (List view, group header, row, row properties), Display properties replacing Table columns, `utils/viewSettings.ts` (`table` → `list` migration, default `list`), remove the Table layout once List covers it, `features/my-issues` on the List with the team on each row.

- [ ] **Step 1: Write the failing tests**: settings migration (`table` with columns → `list` with the same properties); row property list from settings; group-collapse state; move-between-groups patch; range selection.
- [ ] **Step 2: Run** `cd apps/web && bun test src` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build`; screenshots of `/team/ENG` (List), `/my-issues` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Linear's list layout as the default`

### Task 2: Board cards, header row, Display menu

**Files:** `components/common/board/kanban/IssueCardBody.tsx` / `BoardCard.tsx` (compact card), the page header (breadcrumb + view tabs + filter + Display on one line; the separate tabs row goes), `components/layout/Display*` rebuilt as Linear's Display menu (Layout List / Board, Grouping, Sub-grouping, Ordering, Show sub-issues, Completed issues all / past week / past month / none, Display properties; Calendar / Timeline as extra layouts), completed-issues filter helper.

- [ ] **Step 1: Write the failing tests**: completed-issues window helper (fixed `now`); Display menu settings ↔ view preferences mapping.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks; screenshots of the board, the header and the open Display menu (open it via a `?display=open` dev-only query or by rendering the menu in a screenshot route; ledger the method) — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): compact board cards, one header row and Linear's Display menu`

### Task 3: Views pages, sidebar Views, list keyboard

**Files:** `app/team/[teamKey]/views` and `app/views` (lists of saved views: name, owner, layout, shared; open, create, delete as the API allows), sidebar "Views" entries (Workspace and each team; `sidebarModel` updated), list keyboard (J / K focus move, X toggle select, Enter open, Esc clear) using `blocksShortcuts`.

- [ ] **Step 1: Write the failing tests**: `sidebarModel` with Views entries; focus-move helper (wraps within groups, skips collapsed groups); key handling ignored in inputs / dialogs.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks; screenshots of `/team/ENG/views`, `/views`, the sidebar — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Views pages and keyboard in the list`

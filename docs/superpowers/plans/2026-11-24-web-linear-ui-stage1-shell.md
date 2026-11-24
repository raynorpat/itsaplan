# Web UI like Linear — Stage 1 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web app's shell matches Linear's: a workspace-first sidebar, no top bar, a My issues page, one Settings area, Linear's navigation shortcuts, and a working `/inbox`.

**Architecture:** Task 1 rebuilds the sidebar and header and removes the top bar. Task 2 adds My issues and the shortcuts and fixes `/inbox`. Task 3 gathers all settings under `/settings` with redirects. Each task ends with headless-Chrome screenshots.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, gql.tada, shadcn/ui, Lucide; node:test.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (Stage 1)

## Global Constraints

- No page, action or setting is lost; every old address redirects to its new one (`next.config` `redirects()` as in 5.1, not `redirect()` in a streaming page).
- `DESIGN.md` tokens and principles; Lucide icons; no Linear branding.
- Follow `apps/web/AGENTS.md`. Commit per task, no trailer. Questions settled the way Linear does.
- Screenshots: headless Chrome (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --user-data-dir=<scratch profile> --window-size=1440,900 --virtual-time-budget=10000 --screenshot=<file> <url>`), signed in by opening a magic link once in the same profile; API on 3100 and web on 3101 against the test DB with seeded data (the seed script is at `/private/tmp/claude-501/-Users-raynorpat-Projects-itsaplan/08f75146-e9be-4255-85e3-ecbf071fdfcc/scratchpad/seed.ts`; it needs a session cookie jar). Read each screenshot and compare with the spec before committing.

## Review Focus

1. Every route reachable before is reachable after (sidebar, workspace menu, settings, or Cmd+K), and every old settings / account / workspace URL redirects. Test in Task 3 (redirect table test).
2. A guest sees only their teams under "Your teams", no Workspace settings, and no admin-only settings sections. Test in Task 1 / Task 3 (nav gating helpers).
3. The sidebar's team sections reflect join / leave and cycles on / off without a reload. Test in Task 1 (nav model helper).
4. Keyboard shortcuts do not fire while typing in an input, editor or dialog. Test in Task 2 (hotkey helper).
5. `/inbox` renders the inbox for any signed-in user, with or without teams. Checked in Task 2 (screenshot and a route test if feasible).

---

### Task 1: Sidebar and header

**Files:** `components/layout/AppSidebar.tsx` and its `Sidebar*Nav` parts (workspace menu, Inbox / My issues, Workspace section, Your teams with collapsible team sections), `AppHeader` / `Shell*` (page header: breadcrumb, view tabs, filter / display; top bar removed), `TeamSwitcher` / `UserMenu` folded into the workspace menu; rename "Work items" → "Issues" everywhere it is shown.

**Interfaces (Produces):** `sidebarModel({ viewer, teams, cyclesByTeam }) → { workspace: Item[], teams: { team, items: Item[] }[] }`.

- [ ] **Step 1: Write the failing tests**: `sidebarModel` for an admin, a member and a guest (team sections only for joined teams; Cycles only when on; guest sees no Initiatives per project 2).
- [ ] **Step 2: Run** `cd apps/web && bun test src` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build`; screenshots of a team's issues, projects and an issue page — Expected: PASS, screenshots match the spec's sidebar and header.
- [ ] **Step 5: Commit** `feat(web): Linear's sidebar and page header`

### Task 2: My issues, shortcuts, the inbox route

**Files:** `app/my-issues` + `features/my-issues` (tabs Assigned / Created / Subscribed / Activity on GraphQL `viewer.assignedIssues` / `createdIssues` / `issues(filter: { subscribers: { isMe } })` / the viewer's recent history, in the existing list / board views), shortcuts G I / G M / G P / Cmd+, in the hotkey layer, `/inbox` fix.

- [ ] **Step 1: Write the failing tests**: the shortcut sequence helper (G then I within 1 s; ignored while focus is in an input / contenteditable / dialog); My issues tab → filter mapping.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; find and fix why `/inbox` showed a team board.
- [ ] **Step 4: Run** web tests and root checks; screenshots of `/my-issues` (each tab) and `/inbox` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): My issues, navigation shortcuts and the inbox route`

### Task 3: One Settings area

**Files:** `app/settings/...` with its own sidebar (Account, Workspace, Teams sections), moving the existing account, workspace, project labels, MCP, applications and team settings pages under it; `next.config` redirects from every old address; nav gating by role (admin-only workspace sections, team sections for teams the viewer can manage or see as today).

- [ ] **Step 1: Write the failing tests**: the redirect table (every old path → new path); settings nav gating for owner, admin, member, guest.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, build; screenshots of `/settings` (account, workspace general, a team's states) and an old address redirecting — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): one Settings area`

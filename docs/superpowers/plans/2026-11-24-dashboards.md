# Dashboards (Feedback Project 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear-style dashboards of chart / number / table widgets over issues, feedback requests, projects and cycles, computed in the browser, with CSV export and five ready-made dashboards including the Feedback report.

**Architecture:** Task 1 stores dashboards in the API (instance endpoints). Task 2 moves the Insights computation to a shared web layer and adds the widget model, the new data kinds and measures, the period rules and CSV builders as pure functions. Task 3 loads widget data with shared loads and the 5,000 cap. Task 4 builds the pages and the editor. Task 5 adds the templates, Feedback → Reports and the smoke check.

**Tech Stack:** Bun, Elysia, Drizzle, better-auth instance plugin; Next.js 15, React 19, TanStack Query 5, gql.tada, Recharts; `bun test` / `node:test` as each app uses.

**Spec:** `docs/superpowers/specs/2026-11-24-dashboards-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations (next is 0061).
- Guests never see dashboards (API 403, no sidebar item). Team-shared dashboards: members of those teams plus workspace owners / admins. Sharing never changes widget data; data follows the viewer.
- Editors: the owner, and workspace owners / admins; the workspace Feedback report has no owner. Anyone who can see a dashboard may duplicate it.
- Periods: 30 days, 90 days, 6 months, 12 months (default 90 days); team: all or one. Measures have fixed time bases (spec "Periods").
- At most 5,000 rows per load, "Showing the first 5,000" when cut; widgets needing the same rows share one load; nothing fetched while a dashboard is closed.
- CSV holds only what the widget shows; no emails.
- Web features do not import each other (apps/web AGENTS.md): shared code moves to the shared layer.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A team-shared dashboard opened by a member of another team, a guest, or an admin outside the team; a dashboard whose owner left: 404 / 403 / visible / editable by admins only, as Global Constraints say. Test in Task 1.
2. A viewer who is not in a private team, on a dashboard whose widget filters on that team (saved by someone who is): the widget is empty, never an error, never another team's rows; CSV equally empty. Test in Task 2 / Task 3.
3. Periods with no data, a single day of data, and requests whose issue has no `startedAt`: zero states, no NaN medians, the count of left-out issues shown. Test in Task 2.
4. Two people opening Reports for the first time at the same moment: one Feedback dashboard. Test in Task 1.
5. CSV with commas, quotes, newlines, leading `=`/`+`/`-`/`@` in titles: quoted per RFC 4180 and prefixed against formula injection. Test in Task 2.

---

### Task 1: Dashboards in the API

**Files:**
- Modify: `packages/db/src/schema/app.ts` + migration 0061: `dashboard` (id, name 1–255, description, owner_id null (users on delete set null), system_key text unique null (`'feedback'`), shared_with `'workspace' | 'teams'`, team_ids uuid[] default `{}`, widgets jsonb default `[]`, created / updated at).
- Create: `apps/api/src/dashboards/{store.ts, handlers.ts}`
- Modify: `packages/auth/src/instance-plugin.ts`, `apps/api/src/instance/handlers.ts`, `apps/api/src/feedback/requesters.ts` (`RequesterDto.firstFeedbackAt`: earliest active need's `createdAt`, null when none), `apps/api/AGENTS.md`, `packages/auth/AGENTS.md`
- Test: `apps/api/src/dashboards/__tests__/integration/dashboards.test.ts`

**Interfaces:**
- Produces instance endpoints (members, admins, owners; guests 403):
  - `GET /instance/dashboards` → `{ dashboards: DashboardSummary[] }` (`{ id, name, description, ownerId, ownerName, systemKey, sharedWith, teamIds, canEdit, updatedAt }`), only those the user may see.
  - `GET /instance/dashboard?id` → `Dashboard` (summary + `widgets`), 404 when not visible.
  - `POST /instance/dashboards/create { name, description?, sharedWith, teamIds, widgets }` → owner = caller; `teamIds` must be teams the caller is a member of (admins any); `sharedWith: 'teams'` needs ≥ 1 team.
  - `POST /instance/dashboards/update { id, name?, description?, sharedWith?, teamIds?, widgets? }` (editors only, 403 otherwise).
  - `POST /instance/dashboards/delete { id }` (editors).
  - `POST /instance/dashboards/duplicate { id }` → a copy owned by the caller, name "<name> (copy)", `system_key` null.
  - `POST /instance/dashboards/feedback { widgets }` → returns the `system_key = 'feedback'` dashboard, creating it with the given widgets (owner null, workspace-shared, name "Feedback") when missing; `INSERT … ON CONFLICT (system_key) DO NOTHING` then read, so two first opens give one.
- `widgets` validation: array ≤ 24 items, each an object with string `id`, `kind` in `chart | number | table`, `width` in `half | full`, and a `config` object; total JSON ≤ 100 KB (400 otherwise). The web owns the config format.

- [ ] **Step 1: Failing tests:** create / read / list as member; guest 403 on every endpoint; team-shared: member of the team sees it, member of another team gets 404, admin outside the team sees it and can edit; non-owner member update → 403; owner deleted → `ownerId` null, admin edits, member 403; duplicate → caller owns the copy; widgets over 24 or 100 KB → 400; `feedback` twice concurrently → one row; `feedback` dashboard edit by member → 403, by admin OK; delete it and call `feedback` again → recreated; requesters list returns `firstFeedbackAt`.
- [ ] **Step 2: Run** `cd apps/api && bun test src/dashboards` — Expected: FAIL.
- [ ] **Step 3: Implement**, `bun run db:generate`, `bun run db:migrate:test`.
- [ ] **Step 4: Run** full API suite (object-store tests excepted), root `format:check`, `lint`, `typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): dashboards`

### Task 2: Widget model, measures, periods and CSV (pure web code)

**Files:**
- Move (pure relocation, imports updated): `apps/web/src/features/insights/utils/{measures,slices,stats,overTime,data,context,palette}.ts` and their tests → `apps/web/src/utils/insights/`; the Insights feature imports from there.
- Create: `apps/web/src/utils/dashboards/{config.ts, periods.ts, feedbackMeasures.ts, projectMeasures.ts, cycleMeasures.ts, compute.ts, csv.ts}` with tests in `apps/web/src/utils/dashboards/__tests__/`

**Interfaces:**
- Produces:
  - `type DataKind = 'issues' | 'requests' | 'projects' | 'cycles'`; `type WidgetKind = 'chart' | 'number' | 'table'`; `type DashboardPeriod = '30d' | '90d' | '6m' | '12m'`.
  - `type WidgetConfig = { title: string; data: DataKind; filter: FilterCondition[] (issue view filter shape) | ProjectFilter | CycleFilter; measure: string; slice: string | null; segment: string | null; chart?: 'bars' | 'overTimeBars' | 'overTimeLine'; table?: { columns: string[]; limit: number (5–50); sort: string } }`; `type Widget = { id: string; kind: WidgetKind; width: 'half' | 'full'; config: WidgetConfig }`; `parseWidgets(raw: unknown): Widget[]` (drops invalid widgets).
  - `MEASURES: Record<DataKind, { id; label; basis: 'current' | 'events'; unit: 'count' | 'points' | 'days' | 'percent' }[]>` including requests: `requests`, `people`, `newPeople`, `timeToStart`, `timeToDone`, `importantShare`; projects: `projects`, `avgProgress`; cycles: `completedScope`, `scope`, `carriedOver`, `currentProgress`; issues: the existing Insights measures.
  - `SLICES: Record<DataKind, string[]>` (requests add `source` with keys `team | portal | form`, `important`; projects `health` (`onTrack | atRisk | offTrack | none`), `status`, `lead`, `team`; cycles `cycle`, `team`).
  - `periodRange(period: DashboardPeriod, now: Date): { start: Date; end: Date; previousStart: Date }`.
  - `computeWidget(widget: Widget, rows: WidgetRows, ctx: ComputeContext): WidgetResult` where `WidgetResult = { kind: 'bars'; rows: BreakdownRow[] } | { kind: 'overTime'; weeks: { week: string; values: Record<string, number> }[] } | { kind: 'number'; value: number | null; previous: number | null; unit } | { kind: 'table'; columns; rows: { id; href; cells: Record<string, string | number | null> }[] }`, plus `excluded: number` (rows left out for missing dates) and `capped: boolean`. Applies the measure's basis: `current` ignores the period; `events` keeps events inside `[start, end)`, and the number's `previous` uses `[previousStart, start)`. `timeToStart` / `timeToDone` = issue `startedAt` / `completedAt` minus the issue's earliest request `createdAt`, for issues started / completed in the period; `newPeople` = requesters whose `firstFeedbackAt` is in the period. With team "all" and cycles data, results are grouped per team in each team's unit.
  - `toCsv(widget: Widget, result: WidgetResult): string` — RFC 4180 quoting; cells starting with `=`, `+`, `-`, `@` prefixed with `'`; headers from the measure / slice labels; columns: bars → slice, [segment], value, share; over time → week, one column per series; number → measure, period start, period end, value, previous; table → its columns.

- [ ] **Step 1: Failing tests:** moved Insights tests still pass from the new path; `parseWidgets` drops bad items; `periodRange` for each period; each requests measure on samples (two requests from one person count 2 requests / 1 person; source slice from `source`; first request before the period still measures time to start; issue without `startedAt` excluded and counted in `excluded`; empty input → zero / null, no NaN); projects by health with "none"; cycles grouped per team in their units; `current` basis ignores the period, `events` respects it, number `previous` from the previous range; `toCsv` quoting, newlines and formula prefixes for each result kind.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/dashboards src/utils/insights src/features/insights` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): dashboard widget computation`

### Task 3: Widget data loading

**Files:**
- Create: `apps/web/src/services/dashboardData.service.ts`, `apps/web/src/hooks/useWidgetRows.ts`, `apps/web/src/utils/dashboards/loads.ts` (+ tests)
- Modify: `apps/web/src/features/insights/services/insightsIssues.service.ts` only if its paging helper moves to the shared service (pure relocation)

**Interfaces:**
- Consumes: Task 2 types; Linear GraphQL (`issues(filter)`, `customerNeeds(filter)` with `attachment { metadata externalUserCreator { id } }` and `issue { … }`, `projects` with `progress`, `health` of `lastUpdate`, `targetDate`, histories, `cycles` with `scopeHistory`, `completedScopeHistory`, `uncompletedIssuesUponClose`); Task 1 requesters list for `firstFeedbackAt`.
- Produces:
  - `type LoadKey = string`; `loadKeyFor(widget: Widget, dashboard: { period: DashboardPeriod; teamId: string | null }, now: Date): LoadKey` — equal for widgets that need the same rows (same data kind, filter, team and period window; `current`-basis widgets of issues share one "open issues" load).
  - `loadRows(key: LoadKey): Promise<WidgetRows & { capped: boolean }>` — pages of 250 up to 5,000 rows; only the fields the measures need.
  - `useWidgetRows(widget, dashboardState, enabled: boolean)` — TanStack Query keyed by `LoadKey`, so widgets share loads; `enabled` false while the dashboard is not open.

- [ ] **Step 1: Failing tests:** `loadKeyFor` equal for two widgets that need the same rows and different when filter, team, period or basis differ; the GraphQL filter built for a widget with a team filter plus the dashboard team combines both (and yields an empty result filter when they conflict, without a request); paging stops at 5,000 and sets `capped`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks incl. build — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): dashboard widget data`

### Task 4: Dashboard pages and editor

**Files:**
- Create: `apps/web/src/app/dashboards/{layout.tsx, page.tsx, [dashboardId]/page.tsx}`, `apps/web/src/features/dashboards/{DashboardsPage.tsx, DashboardPage.tsx, services/dashboards.service.ts, components/{DashboardGrid, WidgetCard, WidgetChart, WidgetNumber, WidgetTable, WidgetSlicePanel, WidgetEditor, DashboardHeader, DashboardShareDialog, NewDashboardDialog}.tsx, utils/layout.ts}`
- Modify: sidebar (Workspace → Dashboards; not for guests) and its model test; `utils/paths.ts`
- Test: `apps/web/src/features/dashboards/utils/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `moveWidget(widgets, from, to): Widget[]`, `rowsOf(widgets): Widget[][]` (packs half widgets two per row in order, full widgets alone), `newWidget(data: DataKind): Widget` (sensible default measure / slice / kind), `dashboardFilterKey(dashboardId): string` (localStorage key for period and team).
- Pages: list (name, owner, sharing, updated; New dashboard: blank or template — templates come in Task 5, the dialog lists what `TEMPLATES` exports, empty until then); dashboard page with header (name, description, period and team pickers, Edit, Duplicate, Share, Delete for editors), grid of widgets, each with title, result, "Showing the first 5,000" / "N left out" notes, menu (Export CSV, and in edit mode Edit / Remove / Half · Full); slice click → side panel listing the slice's items; table row → issue / project / cycle page; edit mode with drag reorder, Add widget, the widget editor (data kind, filter, measure, slice, segment, display, table columns / limit), Save / Cancel. Read-only users see no edit controls.

- [ ] **Step 1: Failing tests** for the four helpers and the sidebar item's visibility by role.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks incl. build — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): dashboards`

### Task 5: Ready-made dashboards, Feedback → Reports and smoke check

**Files:**
- Create: `apps/web/src/utils/dashboards/templates.ts` (+ test), `apps/web/src/app/feedback/reports/page.tsx`, `apps/web/src/features/feedback/ReportsPage.tsx`
- Modify: the New dashboard dialog (template list), Feedback sidebar (People, Reports)

**Interfaces:**
- Produces: `TEMPLATES: { key: 'feedback' | 'delivery' | 'projects' | 'cycles' | 'bugs'; name; description; widgets(ctx: { bugLabelId: string | null }): Widget[] }[]` with the widgets listed in the spec's "Ready-made dashboards" (Bugs: the filter uses `bugLabelId`; when null the dialog asks for a label first). `ReportsPage` calls `POST /instance/dashboards/feedback` with the Feedback template's widgets and renders `DashboardPage` for the result.

- [ ] **Step 1: Failing tests:** each template's widgets pass `parseWidgets` unchanged; Feedback has the requests-per-week-by-source chart, the top-20 not-done table and the time-to-start / done numbers; Bugs widgets all filter on the given label; Cycles widgets use cycles data.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check (test DB, seed with issues across past weeks via SQL dates, estimates, cycles, projects with updates and health, feedback from team / portal / form sources; API 3100, web 3101, headless Chrome): open Feedback → Reports (dashboard created, all widgets render with plausible numbers), change period and team, click a bar → side panel, click a table row → issue; Export CSV of a chart and a table (files saved and read back); create each of the other four templates and check every widget renders; edit mode: add, resize, drag, remove, save; duplicate as a member; team-shared dashboard invisible to a member of another team; guest sees no Dashboards item. Screenshots `<scratchpad>/shots/dashboards-*.png` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): ready-made dashboards and feedback reports`

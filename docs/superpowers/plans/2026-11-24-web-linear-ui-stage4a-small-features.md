# Web UI like Linear, Stage 4a (Small Missing Features) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web exposes cycle create / archive, project archive, label retire / restore and the inbox's unsnooze-all and single archive; activity names workflows and apps; the API records parent changes.

**Architecture:** Task 1 is API (issue activity + history resolver) plus its feed line; Task 2 is the shared actor display; Tasks 3–4 are web screens on mutations the API already serves. Pure logic in feature `utils/` with tests.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga (Linear's SDL); Next.js 15, React 19, TanStack Query 5, gql.tada, shadcn/ui; `bun test` in `apps/api` and `apps/web`.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (section "Stage 4a")

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations if any.
- Hide controls the API would refuse (team / project / label permissions as the existing pages already gate them).
- API refusals show the API's message (toast).
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A history entry whose parent issue was since deleted or is not visible to the viewer: the line still renders ("set parent" without a link, or the stored identifier) and the feed does not break. Test in Task 1 (API: `fromParent` null when the issue is gone) and Task 1 web helper.
2. A workflow that was deleted after it acted: the entry still renders with a fallback name ("a workflow"). Test in Task 2 (`actorDisplay` with a bot actor without name).
3. Retiring a label that is on open issues: the issues keep it and it shows on them; it disappears only from pickers. Test in Task 4 (label list helper splits active / retired).
4. Archiving the current or an upcoming cycle is not offered (only past cycles). Test in Task 3 (`canArchiveCycle`).
5. `E` while typing in the inbox (search or comment box) types the letter. Test in Task 4 (`inboxKeyAction` on a typing target → null).

---

### Task 1: Parent changes in issue history

**Files:** `apps/api/src/issues/activity.ts` (event `action: 'parent'` with from / to issue ids when `parentId` changes), the issue history resolver (`apps/api/src/graphql/resolvers/history.ts`: `fromParentId`, `toParentId`, `fromParent`, `toParent` through the request loaders, null when not found or not visible), migration only if the activity table cannot store the two ids in existing columns (prefer existing `from_id` / `to_id`); web `features/issue/services/issueFeed.service.ts` (read `fromParent { identifier }`, `toParent { identifier }`), `features/issue/utils/feed.ts` / `activityText.tsx` (the three lines).

**Interfaces:** Produces `parentChangeText(from: string | null, to: string | null): string` in `features/issue/utils/activityText.tsx` (or a sibling `.ts` util): `'set parent to ENG-3'`, `'changed parent from ENG-3 to ENG-5'`, `'removed parent ENG-3'`; a missing identifier on either side reads `'an issue'`.

- [ ] **Step 1: Failing tests.** API `apps/api/src/graphql/__tests__/integration/history.test.ts`: set parent → entry with `toParentId` / `toParent.identifier`; change → both; remove → `fromParent` only; a history entry whose former parent was deleted → `fromParentId` set, `fromParent` null. Web: `parentChangeText` cases above including the null-identifier case.
- [ ] **Step 2: Run** `cd apps/api && bun --env-file=../../.env.test test src/graphql/__tests__/integration/history.test.ts` and `cd apps/web && bun test` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full API suite (object-store tests excepted), web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: parent changes in issue history`

### Task 2: Workflow and app actors in activity and comments

**Files:** issue feed and comment queries (`botActor { id name type }`, `user { app }` / `actor { app }`), project activity query, `utils/actorDisplay.ts` (new), the rows that render actors (`ActivityLine`, comment header in `components/common/comments/*`, `ProjectFeedRow`), a small `AppBadge` and workflow icon (Lucide `Workflow`).

**Interfaces:** Produces `actorDisplay(entry: { actor?: { name: string; app?: boolean } | null; botActor?: { type?: string | null; name?: string | null } | null }): { kind: 'user' | 'app' | 'workflow' | 'unknown'; name: string }`; a `workflow` bot without a name → name `'a workflow'`.

- [ ] **Step 1: Failing tests** `utils/__tests__/actorDisplay.test.ts`: user → `{kind:'user'}`; `app: true` → `'app'`; `botActor {type:'workflow', name:'Auto-close'}` → `{kind:'workflow', name:'Auto-close'}`; workflow without name → `'a workflow'`; neither → `'unknown'`.
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/__tests__/actorDisplay.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement**; workflow entries read "<change> · via workflow <name>" with the workflow icon in place of the avatar; app users get an "App" badge after the name.
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): workflow and app actors in activity and comments`

### Task 3: Cycle create / archive and project archive

**Files:** `features/cycles/` (New cycle dialog on the cycles page, ⋯ menu on past `CycleRow`s with Archive, collapsible "Archived" section from `team.cycles(includeArchived: true)` filtered to archived), `features/cycles/services/cycles.service.ts` (`cycleCreate`, `cycleArchive`), `features/projects/` (Archive / Unarchive in `ProjectActions`, archived banner in the project header, "Archived" filter on the list through `includeArchived` + `archivedAt` check), cache refresh of the cycles and projects queries.

**Interfaces:** Produces `canArchiveCycle(cycle: { endsAt: string; archivedAt?: string | null }, now: Date): boolean` (true only when ended and not archived) and `newCycleInput(form: { name: string; startsAt: string; endsAt: string }, teamId: string): { teamId; startsAt; endsAt; name? } | { error: string }` (end after start; blank name omitted).

- [ ] **Step 1: Failing tests** for both helpers (current / upcoming / past / archived cycles; end before start → error; blank name omitted).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): create and archive cycles, archive projects`

### Task 4: Label retire / restore, inbox actions, smoke check

**Files:** labels settings (`features/settings/components/labels/*`: Retire in the label menu, "Retired labels" section with Restore, list read with `includeArchived` where needed), `features/inbox/` (Unsnooze all in the toolbar ⋯ menu, hover archive button on `InboxListItem`, `E` on the focused row), services for `issueLabelRetire` / `issueLabelRestore` / `notificationUnsnoozeAll`.

**Interfaces:** Produces `splitLabels<T extends { retiredAt?: string | null }>(labels: T[]): { active: T[]; retired: T[] }` and `inboxKeyAction(e, combos): 'archive' | null` (E; null on typing targets via `blocksShortcuts`).

- [ ] **Step 1: Failing tests** for `splitLabels` and `inboxKeyAction`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check against the test DB (API 3100, web 3101, seed): create and archive a cycle, archive and unarchive a project, retire and restore a label, unsnooze all and archive one notification, set a parent (activity line), a workflow rule acting on an issue ("via workflow" line); headless Chrome screenshots of the cycles page, the archived project, labels settings, inbox, issue activity — Expected: PASS and the screenshots show each.
- [ ] **Step 5: Commit** `feat(web): retire labels and inbox archive and unsnooze all`

# Web UI like Linear, Stage 3 (Issue Page and Peek) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The issue page, side panel and inbox pane take Linear's layout, issues gain sub-issues and a parent, the page moves through the list it came from, and Space peeks an issue from the list.

**Architecture:** Web only; the API already accepts `parentId` on `issueCreate` / `issueUpdate` and serves `Issue.children` / `Issue.parent`. `IssueDetailContent` stays the one body for page, panel and inbox. Pure logic goes in `utils/` or `features/issue/utils/` with unit tests; components follow `apps/web/AGENTS.md` and `DESIGN.md`.

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, gql.tada, shadcn/ui, Lucide; `bun test` in `apps/web`.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (section "Stage 3: issue page and peek")

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes (part of `typecheck`).
- Sub-issue progress: done = completed or canceled children, out of all children.
- A new sub-issue goes in the team's first state (`team.states[0]`), with `parentId` set.
- Without a remembered list the page shows no position and no up / down buttons.
- My issues has no peek; Space there does nothing.
- The account's `issueOpenMode` default is `'page'`.
- Hide controls the API would refuse (`usePermissions(team).can('work_items', 'edit')`).
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. The list the page came from changes after opening (an issue is closed or filtered out): up / down skip nothing and never land on an issue missing from the list; the current issue not in the remembered list hides the position. Test in Task 3 (`adjacentIssue` with an id not in the order).
2. Typing J, K or Space in the comment box, title or description inside the peek panel types the letter and does not navigate or close. Test in Task 4 (`peekKeyAction` on a typing target).
3. Setting a parent to the issue itself or one of its sub-issues is not offered; a refusal from the API (another team) shows its message and changes nothing. Test in Task 2 (`parentCandidates`).
4. Adding a sub-issue with an empty or whitespace title creates nothing. Test in Task 2 (`subIssueInput`).
5. Space on a focused button or link in the list (e.g. a group header +) activates the button and does not open peek. Test in Task 4 (`listKeyAction` returns null for Space on a button target).

---

### Task 1: Linear's issue layout

**Files:**
- Modify: `apps/web/src/features/issue/components/detail/IssueDetailContent.tsx` (order: title, description, reactions, links and attachments, sub-issues slot left empty for Task 2, relations, documents, activity; the three layouts keep their shapes)
- Modify: `apps/web/src/features/issue/components/detail/IssueProperties.tsx` (flat rows: icon and control, no name column, no card; same fields)
- Modify: `apps/web/src/features/issue/components/detail/IssueAttachmentsPanel.tsx` (compact rows, one line per link / file, an "add" control in the section header)
- Modify: `apps/web/src/features/issue/components/relations/IssueRelations.tsx` (compact rows)
- Modify: `apps/web/src/features/issue/components/detail/IssueActivityFeed.tsx` (header row "Activity" with `IssueSubscribers` on the right; the comment composer at the bottom)
- Modify: `apps/web/src/features/issue/components/actions/IssueActionsBar.tsx` → rename to `IssueActionsMenu.tsx`: one "⋯" `DropdownMenu` with Copy link, Copy prompt, Archive / Restore, Delete (Task 2 adds parent items)
- Modify: `apps/web/src/features/issue/components/detail/IssueDetail.tsx` (panel header: identifier, ⋯ menu, open as page, close)
- Modify: `apps/web/src/features/issue/IssueViewPage.tsx` (⋯ menu in the header through `PageHeaderPortal`; the properties `aside` without the actions bar)
- Delete: `IssueStatusTimeline.tsx`, `IssueTimeline*.tsx` under `features/issue/components/detail/`, and `features/issue/utils/timeline.ts` with its tests if no other caller imports them (grep first)
- Test: `apps/web/src/features/issue/utils/__tests__/issueActions.test.ts`

**Interfaces:**
- Produces: `issueMenuItems({ canEdit, canDelete, archived }): IssueMenuItemId[]` in `features/issue/utils/issueActions.ts`, with `type IssueMenuItemId = 'copyLink' | 'copyPrompt' | 'archive' | 'restore' | 'delete' | 'setParent' | 'removeParent'`; `IssueActionsMenu` props `{ team, issue, onDeleted?, onSetParent?: () => void }`.

- [ ] **Step 1: Write the failing test** `issueActions.test.ts`:
  - `issueMenuItems({ canEdit: true, canDelete: true, archived: false })` → `['copyLink', 'copyPrompt', 'archive', 'delete']`
  - `archived: true` → contains `'restore'`, not `'archive'`
  - `canEdit: false, canDelete: false` → `['copyLink', 'copyPrompt']`
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/issue/utils/__tests__/issueActions.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `issueMenuItems`, `IssueActionsMenu`, and the layout changes listed under Files. Remove the timeline files after `grep -rn "IssueStatusTimeline\|issue/utils/timeline" apps/web/src` shows no other importer.
- [ ] **Step 4: Run** `cd apps/web && bun test` and from the root `bun run format:check && bun run lint && bun run typecheck && bun run build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Linear's issue layout with a flat properties sidebar`

### Task 2: Sub-issues and parent

**Files:**
- Modify: `apps/web/src/types/issue.ts` (`IssuePatch.parentId?: string | null`; `IssueDetail.parent: { id: string; identifier: string; title: string } | null`)
- Modify: `apps/web/src/services/issues.service.ts` (issue query reads `parent { id identifier title }`; patch maps `parentId`; `useSubIssuesQuery(issueId)` on `issue(id).children(first: 250)` with id, identifier, title, priority, state { id name type color }, assignee { id name avatarUrl }; its key joins the issue-dependent refresh keys)
- Create: `apps/web/src/features/issue/utils/subIssues.ts`
- Create: `apps/web/src/features/issue/components/subissues/IssueSubIssues.tsx` (header "Sub-issues" with "2/5", rows open the sub-issue through `onOpenIssue(id, 'page')`, inline "+ Add sub-issue" input when `canEdit`, Enter creates through `issueCreate`, Escape cancels)
- Create: `apps/web/src/features/issue/components/subissues/SetParentDialog.tsx` (issue search as in `IssueRelationPicker`, filtered with `parentCandidates`; picking patches `parentId`; API error shown as a toast with its message)
- Modify: `IssueDetailContent.tsx` (sub-issues section), `IssueActionsMenu.tsx` + `issueActions.ts` (`setParent` when `canEdit`; `removeParent` when `canEdit` and the issue has a parent), `ShellHeaderTitle` (parent identifier as a breadcrumb link before the issue identifier)
- Test: `apps/web/src/features/issue/utils/__tests__/subIssues.test.ts`, `issueActions.test.ts`

**Interfaces:**
- Consumes: `issueMenuItems`, `IssueActionsMenu` (Task 1).
- Produces:
  - `subIssueProgress(children: { state: { type: string } }[]): { done: number; total: number }`
  - `subIssueInput(title: string, team: { id: string; states: { id: string }[] }, parentId: string): { teamId: string; title: string; parentId: string; stateId: string } | null`
  - `parentCandidates<T extends { id: string }>(results: T[], issueId: string, childIds: string[]): T[]`
  - `issueMenuItems` gains `hasParent: boolean` in its argument.

- [ ] **Step 1: Write the failing tests** `subIssues.test.ts`:
  - `subIssueProgress([{state:{type:'completed'}},{state:{type:'canceled'}},{state:{type:'started'}},{state:{type:'unstarted'}},{state:{type:'backlog'}}])` → `{ done: 2, total: 5 }`; `[]` → `{ done: 0, total: 0 }`
  - `subIssueInput('  Fix  ', team, 'p1')` → `{ teamId, title: 'Fix', parentId: 'p1', stateId: team.states[0].id }`; `subIssueInput('   ', …)` → `null`
  - `parentCandidates([{id:'a'},{id:'self'},{id:'c1'}], 'self', ['c1'])` → `[{id:'a'}]`
  - `issueActions.test.ts`: `canEdit: true, hasParent: false` contains `'setParent'`, not `'removeParent'`; `hasParent: true` contains both; `canEdit: false, hasParent: true` contains neither
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/issue/utils/__tests__/` — Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and the files listed.
- [ ] **Step 4: Run** `cd apps/web && bun test` and the root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): sub-issues and the issue parent`

### Task 3: Previous / next issue on the page

**Files:**
- Create: `apps/web/src/utils/issueNavigation.ts` (client memory, like `utils/listFocus.ts`)
- Modify: `apps/web/src/components/common/board/list/ListBody.tsx` and `apps/web/src/features/my-issues/components/MyIssuesList.tsx` (call `rememberListOrder` with the visible rows top to bottom whenever that order changes)
- Modify: `apps/web/src/features/issue/IssueViewPage.tsx` (in the header slot: "3 / 15" and up / down buttons from `adjacentIssue`; J / K go to the next / previous through the `list.next` / `list.prev` combos, ignored on typing targets via `blocksShortcuts`; navigation through `router.push(issuePathFromIdentifier(entry.identifier))`)
- Test: `apps/web/src/utils/__tests__/issueNavigation.test.ts`

**Interfaces:**
- Produces:
  - `type ListOrderEntry = { id: string; identifier: string }`
  - `rememberListOrder(entries: ListOrderEntry[]): void`, `readListOrder(): ListOrderEntry[]`, `clearListOrder(): void` (one remembered list: the last one shown)
  - `adjacentIssue(order: ListOrderEntry[], id: string): { index: number; total: number; prev: ListOrderEntry | null; next: ListOrderEntry | null } | null` (null when `id` is not in `order`; no wrapping at the ends)
  - `issuePathFromIdentifier(identifier: string): string` (uses `issuePath` from `utils/paths.ts`)

- [ ] **Step 1: Write the failing test** `issueNavigation.test.ts`:
  - order `a,b,c`: `adjacentIssue(order,'b')` → `{ index: 1, total: 3, prev: a, next: c }`; `'a'` → prev null; `'c'` → next null; `'x'` → null
  - `rememberListOrder([a,b])` then `readListOrder()` → `[a,b]`; `clearListOrder()` → `[]`
  - `issuePathFromIdentifier('ENG-12')` equals `issuePath('ENG', 12)`
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/__tests__/issueNavigation.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** The displayed position is `index + 1` of `total`.
- [ ] **Step 4: Run** `cd apps/web && bun test` and the root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): previous and next issue on the issue page`

### Task 4: Peek, the page default, and a smoke check

**Files:**
- Modify: `apps/web/src/utils/hotkeys.ts` (`'list.peek'`, label "Peek the issue", group List, combo `space`, scope app)
- Modify: `apps/web/src/utils/list.ts` (`listKeyAction` returns `'peek'` for the `list.peek` combo; `ListKeyAction` gains `'peek'`; `peekKeyAction`)
- Modify: `apps/web/src/hooks/useListKeyboard.ts` (`onPeek?: (id: string) => void`, called with the focused row, else the hovered row; `hoveredRef` set by the list rows' mouse enter / leave)
- Modify: `ListBody.tsx` (passes `onPeek: (id) => onOpenIssue(id, 'panel')` and hover tracking); My issues passes no `onPeek`
- Modify: `apps/web/src/features/issue/components/detail/IssueDetail.tsx` (while open: `peekKeyAction` on window keydown; `'close'` closes, `'next'` / `'prev'` open the adjacent entry of `readListOrder()` in the panel and `rememberListFocus(listPath, id)` so the list focus follows; the list path is passed by the Shell from the pathname)
- Modify: `apps/web/src/services/preferences.service.ts` (`issueOpenMode` default `'page'`)
- Test: `apps/web/src/utils/__tests__/listKeyboard.test.ts`, `apps/web/src/utils/__tests__/peekKeys.test.ts`, the preferences default test where the existing defaults are tested (else `services/__tests__/preferences.test.ts`)

**Interfaces:**
- Consumes: `readListOrder`, `adjacentIssue` (Task 3); `rememberListFocus` (`utils/listFocus.ts`).
- Produces: `peekKeyAction(e: KeyEventLike & { target: EventTarget | null; defaultPrevented?: boolean }, combos: HotkeyCombos): 'next' | 'prev' | 'close' | null` in `utils/list.ts`.

- [ ] **Step 1: Write the failing tests**:
  - `listKeyAction` with `key: ' '` on the list body → `'peek'`; on a `button` target → `null`
  - `peekKeyAction`: `j` → `'next'`, `k` → `'prev'`, Space and Escape → `'close'`; `j` / Space on an `input`, `textarea` or contenteditable target → `null`; a `defaultPrevented` Escape → `null`
  - preferences default `issueOpenMode === 'page'`
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/__tests__/` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd apps/web && bun test`, the root checks, then a smoke check against the test DB (API 3100, web 3101, seed script): open an ENG issue page (breadcrumb, "n / 15", ⋯ menu, flat properties, no status timeline), add a sub-issue and set a parent, press K / J on the page, press Space on a list row then J and Escape, open `/inbox`; headless Chrome screenshots of the page, the peek and the inbox pane — Expected: PASS and the screenshots show each part.
- [ ] **Step 5: Commit** `feat(web): peek issues from the list with Space`

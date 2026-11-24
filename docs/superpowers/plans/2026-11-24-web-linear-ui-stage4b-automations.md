# Web UI like Linear, Stage 4b (Workflow Automations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team settings gain an Automations page that lists, orders, enables, archives and deletes workflow rules, and an editor that creates and changes them.

**Architecture:** Web only, on the instance plugin's `/api/auth/instance/workflows*` endpoints through the existing `instanceFetch` pattern (`features/workspace/services/oauthApps.service.ts`). Feature folder `apps/web/src/features/automations/` with services, utils (tested) and components; pages under `app/settings/teams/[teamKey]/automations/`. The conditions editor reuses `components/layout/FilterBar.tsx` and `utils/viewFilters.ts` (`filterSetToIssueFilter` / `issueFilterToFilterSet`).

**Tech Stack:** Next.js 15, React 19, TanStack Query 5, shadcn/ui, dnd-kit, Lucide; `bun test` in `apps/web`.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (section "Stage 4b"); API rules in `docs/superpowers/specs/2026-11-24-workflow-automations-design.md` and `apps/api/src/workflows/{access,validate,handlers}.ts`.

## Global Constraints

- No API change. Show controls only where the API allows them (`access.ts`): create and edit access need a team manager (team owner) or workspace admin / owner; editing follows the rule's `editAccess`; guests change nothing.
- The API's error message is shown as returned.
- Copy: page title "Automations"; triggers "When an issue is created" / "When an issue starts matching the conditions".
- Follow `apps/web/AGENTS.md` and `DESIGN.md`. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A rule whose conditions use a field the web filter builder cannot show (written by the API or MCP): opening and saving it without touching If keeps the conditions unchanged. Test in Task 2 (`ruleToForm` keeps unknown conditions; `formToRuleInput` sends them back unchanged when the filter was not edited).
2. An action that points at a state, label, project or cycle that no longer exists: the editor shows it as missing and saving without fixing it shows the API's message, not a crash. Test in Task 2 (`actionSummary` with an unknown id).
3. A member without edit rights opens a rule's URL directly: the editor is read-only and has no Save. Test in Task 1 (`canEditRule`).
4. Reordering while one rule is archived: archived rules are not part of the order sent. Test in Task 1 (`reorderIds`).
5. Switching the trigger to "starts matching" with no conditions: Save is blocked with a message before any request. Test in Task 2 (`formToRuleInput` error).

---

### Task 1: Automations list

**Files:** `features/automations/services/automations.service.ts` (list, enable, reorder, archive, unarchive, delete; query key in `services/queryKeys.ts`), `features/automations/utils/rules.ts`, `features/automations/components/AutomationsPage.tsx` + row / menu components, route `app/settings/teams/[teamKey]/automations/page.tsx`, team entry in `utils/settingsNav.ts`.

**Interfaces:** Produces
- `type WorkflowRule` (fields as the API's list returns: id, name, description, trigger, activationMode, conditions, activities, enabled, sortOrder, editAccess, ownerId, lastExecutedAt, stats `{ runs: number; lastError?: string }`, archivedAt, teamId)
- `canCreateRule(viewer: { role: WorkspaceRole; managesTeam: boolean }): boolean`
- `canEditRule(rule: Pick<WorkflowRule, 'editAccess' | 'ownerId'>, viewer: { id: string; role: WorkspaceRole; managesTeam: boolean }): boolean` (mirror of `assertMayEdit`)
- `triggerSummary(rule): string`
- `reorderIds(rules: WorkflowRule[], activeId: string, overId: string): string[]` (unarchived only, in new order)

- [ ] **Step 1: Failing tests** `features/automations/utils/__tests__/rules.test.ts`: guest → both false; admin → edit any; member with `everyone` → true, with `teamOwners` → only when `managesTeam`, `workspaceAdmins` → false, `owner` → only when `ownerId === id`; `canCreateRule` true for admin or team manager; `reorderIds` moves and leaves archived out; `triggerSummary` for both triggers.
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/automations` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): team automations list`

### Task 2: Automation editor and smoke check

**Files:** `features/automations/utils/ruleForm.ts`, `features/automations/components/AutomationEditor.tsx` (+ `ActionRow.tsx`), routes `…/automations/new/page.tsx` and `…/automations/[ruleId]/page.tsx`, services create / update / get.

**Interfaces:** Consumes Task 1's types and `canEditRule` / `canCreateRule`. Produces
- `type RuleForm = { name: string; description: string; trigger: 'entityCreated' | 'entityUpdated'; filters: FilterSet; filtersEdited: boolean; rawConditions: Record<string, unknown>; actions: WorkflowAction[]; editAccess: EditAccess }`
- `ruleToForm(rule: WorkflowRule | null): RuleForm`
- `formToRuleInput(form: RuleForm, teamId: string): { input: Record<string, unknown> } | { error: string }` (name required; `entityUpdated` needs a non-empty condition; empty `addComment` body and empty label lists are errors; `activationMode` `conditionsStartedMatching` for `entityUpdated`, null otherwise; conditions = `rawConditions` when not edited)
- `actionSummary(action: WorkflowAction, team: TeamDetail): { text: string; missing: boolean }`

- [ ] **Step 1: Failing tests** `ruleForm.test.ts`: round trip of a rule; untouched unknown conditions kept; edited filters converted with `filterSetToIssueFilter`; each error case above; `actionSummary` for a known state ("Set status to Done") and an unknown id (`missing: true`).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; read-only form when `!canEditRule`; edit access select only when the viewer manages the team or is an admin.
- [ ] **Step 4: Run** web tests and root checks; smoke check against the test DB (API 3100, web 3101, seed): create a rule "Urgent to Todo" (When created, If priority is Urgent, Then set status Todo and add a comment), create an urgent issue and see the change and "via workflow" in its activity, reorder two rules, disable one, archive and unarchive one; headless Chrome screenshots of the list and the editor — Expected: PASS and the screenshots show each.
- [ ] **Step 5: Commit** `feat(web): automation editor`

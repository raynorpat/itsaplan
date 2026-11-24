# Workflow Automations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams have Linear-style issue automations: rules that run when an issue is created or starts matching conditions, applying field changes and comments attributed to the workflow.

**Architecture:** Task 1 adds the model, validation and the management endpoints. Task 2 adds the run engine in the issues store with workflow attribution in history, comments, webhooks and GraphQL. API only.

**Tech Stack:** Bun, Elysia, Drizzle/Postgres, graphql-yoga with Linear's SDL, better-auth instance plugin; Bun tests.

**Spec:** `docs/superpowers/specs/2026-11-24-workflow-automations-design.md`

## Global Constraints

- Linear's SDL is never edited. Incremental migrations.
- `type: automation`, `triggerType: issue`, `trigger: entityCreated | entityUpdated`, `activationMode: conditionsStartedMatching` for updates; everything else refused.
- Conditions: Linear's `IssueFilter` JSON through `issueFilterSql` (moved out of `graphql/`); `isMe` = rule owner; `entityUpdated` needs non-empty conditions.
- Actions: `setState`, `setAssignee`, `setPriority`, `addLabels`, `removeLabels`, `setProject`, `setCycle`, `setDelegate`, `addComment`; validated on save; skipped at run time when no longer valid (recorded in `stats.lastError`).
- One combined workflow update per triggering change, after the person's change, rules in `sortOrder`, later rule wins per field; comments after. No user actor; history / comments carry the workflow id; webhook actor `{ id, type: 'workflow', name }`; GraphQL `botActor` `{ type: workflow, id, name }`. Workflow changes never trigger rules; system updates do not trigger rules.
- Best-effort: a failing rule never fails the person's change.
- Edit access per `editAccess` (default `teamOwners`); guests and app users never edit; anyone who sees the team lists.
- Follow AGENTS.md files. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A workflow's change never triggers workflows (A sets a label that B's conditions match → B does not run off A's change). Test in Task 2.
2. An update rule runs only when the issue starts matching: editing a matching issue again does not run it. Test in Task 2.
3. A guest, an app user, or a member under `editAccess: teamOwners` cannot create, edit or delete a rule; a rule cannot reference another team's state, label, cycle or a non-assignable delegate. Test in Task 1.
4. A rule whose action fails at run time (label archived, delegate uninstalled) still applies its other actions, records the error, and the person's change succeeds. Test in Task 2.
5. A 50-issue batch update runs the rules once per issue with a bounded number of queries per issue (team rules loaded once per batch). Test in Task 2.

---

### Task 1: Model, validation, management endpoints

**Files:** `packages/db` (`workflow_definition` table per the spec; `issue_activity.workflow_definition_id` and `comment.workflow_definition_id` columns, nullable, set null on rule delete; migration), move `apps/api/src/graphql/issue-filter.ts` (and what it needs) to a shared location (e.g. `apps/api/src/issues/filter.ts`) with GraphQL importing it, `apps/api/src/workflows/` (store, validation, access), instance plugin endpoints `/api/auth/instance/workflows*` (list by team, get, create, update, enable/disable, reorder, archive, unarchive, delete) with handlers in `apps/api/src/instance/handlers.ts`, GraphQL `WorkflowDefinition` field resolvers (for `botActor` references) and `IssueFilter.sourceMetadata.workflowDefinitionId` support.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/workflows/__tests__/integration/workflows-admin.test.ts`): create / list / update / reorder / archive / delete as a team owner and as an admin; member refused under `teamOwners`, allowed under `everyone`; guest and app user refused; `owner` edit access; validation refusals (other team's state / label / cycle, unknown filter field, empty conditions on `entityUpdated`, unsupported type / trigger, non-assignable delegate); Origin check on cookie POSTs; a member of another team cannot list.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat: workflow automation rules and their management`

### Task 2: Run engine and attribution

**Files:** issues store `createIssue` / `updateIssue` hook (load the team's enabled rules once per call or batch; one filter query before the write and one after; compute the combined patch; apply through `updateIssue` with a workflow marker that skips rules and system opt-out; comments with the workflow id), system callers pass the opt-out (cycle rollover / archive, duplicate auto-cancel, restore move), history and webhook attribution (`actorFor` workflow actor), GraphQL `IssueHistory.botActor` / `Comment.botActor`, notifications with no user actor, delegation via the rule owner as session creator, `stats` / `lastExecutedAt`.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/workflows/__tests__/integration/workflow-runs.test.ts`): `entityCreated` rule applies on create; `entityUpdated` applies when the issue starts matching and not again on a second edit (Review Focus 2); rule order and later-rule-wins; no loop (Review Focus 1); system updates (cycle rollover) do not trigger; failing action recorded, other actions applied, person's change succeeds (Review Focus 4); history entry and webhook carry the workflow, `botActor` resolves; workflow comment has `botActor`, no author, subscribes no one; assigned person is notified; delegation starts an agent session with the rule owner as creator; batch of 50 bounded queries (Review Focus 5); disabled / archived rules do not run.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full API suite, root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): run workflow automations on issue changes`

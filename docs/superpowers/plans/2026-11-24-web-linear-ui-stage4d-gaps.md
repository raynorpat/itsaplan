# Web UI like Linear, Stage 4d (Closing the Gaps) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Projects go to the trash as in Linear, deleted workflows keep their name, notifications name the workflow that caused them, workspace labels get a settings page, and the two unchecked states are checked in a browser.

**Architecture:** Tasks 1–2 change the API (with migrations as needed) and the web screens on top; Task 3 is a web settings page on existing mutations; Task 4 is verification with fixes.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga (Linear's SDL, never edited); worker (Bun); Next.js 15, React 19, TanStack Query 5, gql.tada; `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-24-web-linear-ui-design.md` (section "Stage 4d")

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes with no deprecation warning left from `projectArchive`. Incremental migrations after the latest one.
- Trash purge after 30 days (`PROJECT_TRASH_DAYS = 30`), run by the worker through an internal route, as cycle upkeep and auto-archive are.
- A deleted workflow is never listed, returned by `/instance/workflow`, editable or run.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A trashed project: its issues keep working (they keep their project link and show the project as deleted), it is not offered in project pickers, and restoring it brings back its members, milestones and updates. Test in Task 1.
2. The purge deletes only projects trashed more than 30 days ago, never a merely archived one (archived through the deprecated `projectArchive` by an API client), and its issues lose the project link rather than being deleted. Test in Task 1.
3. A workflow deleted, then a new workflow with the same name created: old entries show the old one, nothing collides. Test in Task 2.
4. A notification caused by a person's change that also triggered a workflow is attributed to the person; only the workflow's own change is attributed to the workflow. Test in Task 2.
5. A member (not admin) opening Settings → Workspace → Labels by URL sees no controls the API would refuse. Test in Task 3 (nav and gating helper).

---

### Task 1: Projects to the trash

**Files:** `apps/api/src/projects/store.ts` (trash, restore, purge), `apps/api/src/graphql/resolvers/project*.ts` (`projectDelete` trashes; `projectUnarchive` restores archived or trashed; `Project.trashed`), an internal route for the purge and its worker job (follow the cycle upkeep / auto-archive pattern in `apps/api/src/cycles/internal-routes.ts` and `apps/worker/src`), migration if `project` has no `trashed` / trashed-at column; web `features/projects/*` (⋯ Delete → trash with a confirm, Restore, "Deleted" tab, trashed banner; remove the Archive / Unarchive items and the `projectArchive` call).

- [ ] **Step 1: Failing tests** API `project-trash.test.ts`: delete → `archivedAt` set and `trashed: true`, not in `projects` without `includeArchived`; `projectUnarchive` → active, `trashed` null, members and milestones intact; purge with a clock 31 days later removes it and nulls its issues' `projectId`; a project archived with `projectArchive` (not trashed) is not purged; a project trashed 29 days ago is not purged. Web: helper for the Deleted tab (`isDeletedProject`) and the banner text.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite (object-store tests excepted), worker tests, web tests, root checks (no `projectArchive` deprecation warning) — Expected: PASS.
- [ ] **Step 5: Commit** `feat: projects go to the trash`

### Task 2: Deleted workflows keep their name; notifications name the workflow

**Files:** `packages/db` (`workflow_definition.deleted_at`; notifications gain a workflow id column), `apps/api/src/workflows/store.ts` (`deleteWorkflow` sets `deletedAt`; every read excludes deleted rows except the `botActor` lookups), `apps/api/src/graphql/resolvers/notification.ts` (`botActor` from the stored workflow), the notification writers called inside the workflow run context, web inbox row rendering (workflow name and icon through `actorDisplay`).

- [ ] **Step 1: Failing tests** API: deleting a workflow keeps history `botActor.name`; comment `botActor.name` after delete; the deleted workflow is not in the list and `get` returns not found; a workflow's status change notifies the assignee with `botActor { type: workflow, name }`; a person's change in the same request notifies as the person. Web: inbox row text helper with a workflow actor.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite, web tests, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: deleted workflows keep their name and notifications name the workflow`

### Task 3: Workspace labels page

**Files:** `utils/settingsNav.ts` (Workspace → Labels, owners and admins), route `app/settings/workspace/labels/page.tsx`, `features/settings/components/labels/*` generalised to a team-or-workspace scope (labels with `teamId` null; create without `teamId`), services as needed.

- [ ] **Step 1: Failing tests**: nav shows Labels for owner and admin, not member or guest; the label-input helper creates without `teamId` for the workspace scope.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): workspace labels settings`

### Task 4: Browser checks

- [ ] **Step 1:** Reset, migrate, seed; invite a second member (organizationInviteCreate, sign up through the invite link's magic link).
- [ ] **Step 2:** As the member, open an automation owned by the owner with edit access `teamOwners`: read-only, no Save; screenshot.
- [ ] **Step 3:** In Chrome (CDP Fetch interception), fail only the `userViewPreferences` request: the list shows the error with Retry; let it through and press Retry: the list loads; screenshot.
- [ ] **Step 4:** Delete a project to the trash and restore it; delete a workflow that acted and check its "via workflow" lines and an inbox row naming it; open Settings → Workspace → Labels and retire a workspace label; screenshots.
- [ ] **Step 5:** Fix anything found (each with a test first where a helper can carry it), run all checks, commit `fix(web): stage 4d browser check fixes` if anything changed.

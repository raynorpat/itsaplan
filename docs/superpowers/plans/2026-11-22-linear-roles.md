# Linear's Roles and Teams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace custom team roles and the permission matrix with Linear's workspace roles, public/private teams, team owners, workspace invites and suspension.

**Architecture:** New columns on `user`, `team`, `team_member` and a `workspace_invite` table; `apps/api/src/shared/access.ts` is rewritten as the one access module that REST guards and GraphQL resolvers call; the matrix, `team_role`, the roles feature and team invites are removed.

**Tech Stack:** Bun, Elysia, better-auth, Drizzle/Postgres, graphql-yoga with Linear's SDL, Next.js.

**Spec:** `docs/superpowers/specs/2026-11-22-linear-roles-design.md`

## Global Constraints

- Roles: `owner`, `admin`, `member`, `guest` (`user.workspace_role`, default `member`); GraphQL `userChangeRole` names member `user`; `app` is INVALID_INPUT.
- Team `visibility` `public` | `private` (default `public`); `team_member.owner` boolean.
- Owners, admins and members see and work in every public team and their private teams; guests only their teams. One SQL helper `visibleTeamIds(userId)` feeds every list.
- The role table in the spec is the rule set; team management = team owners + admins/owners, or any member when the team has no owner.
- At least one workspace owner; nobody invites or promotes above their own role.
- Suspended (`user.suspended_at`): no sign-in, sessions revoked, API keys rejected, no notifications; memberships kept.
- Invites apply at account creation (better-auth user-create hook) and are consumed; inviting an existing account is INVALID_INPUT / 400.
- All-teams webhooks receive public teams only; a private team's webhook needs an admin/owner who is its member.
- God user → owner; better-auth `user.role` removed; god mode allowed for owners and admins; hard user delete owners only.
- Incremental migration; never regenerate the baseline. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A guest added to one team cannot see another public team, its issues, projects or members through any REST route or GraphQL list. Test in Task 1 (REST) and Task 3 (GraphQL).
2. An admin who is not a member of a private team gets 404 / ENTITY_NOT_FOUND for its issues, documents and comments. Test in Task 1.
3. A member inviting someone as admin is refused; an admin inviting as owner is refused. Test in Task 2.
4. Demoting or suspending the last owner is refused. Test in Task 2.
5. A suspended user's API key gets 401 on REST and AUTHENTICATION_ERROR on GraphQL. Test in Task 2.

---

### Task 1: Roles, visibility, team owners and the access module

**Files:** `packages/db/src/schema/app.ts` + `auth.ts` (columns; drop `team_role`, `team_member.role`, `team_member.role_id`; drop better-auth `user.role` via its config + `auth:generate`), migration (god → owner, team `owner` rows → `owner = true`); rewrite `apps/api/src/shared/access.ts`, `guards.ts`, delete `shared/permissions.ts`; update every caller (REST guards and macros, `projects/access.ts`, `initiatives/access.ts`, `documents/access.ts`, `comments/store.ts`, `webhooks/access.ts`, GraphQL `visibleTeamIds` / resolvers, `god` guard); delete `apps/api/src/roles/` and its MCP tools.

**Interfaces (Produces):**
- `type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest'`
- `workspaceRole(userId: string): Promise<WorkspaceRole>`
- `visibleTeamIds(userId: string): SQL` (subquery of team ids) and `memberTeamIds(userId: string): SQL`
- `canSeeTeam(teamId: string, userId: string): Promise<boolean>`; `assertCanSeeTeam(teamId, user)` (404)
- `assertTeamManager(teamId, user)` (403), `assertWorkspaceRole(user, minimum: WorkspaceRole)` (403)
- REST macros: `teamAccess: 'see' | 'manage'` replacing `permission: [...]` / `teamOwner`; `entityGuard(notFound, resolveTeamId, level)`.

- [ ] **Step 1: Write the failing tests** `apps/api/src/shared/__tests__/integration/roles.test.ts` (users via sign-up; roles set with a store helper `setWorkspaceRole` from this task; teams via REST):
  - `members work in public teams without joining` — owner creates public team MKT and an issue; a member who never joined reads it (200) and comments (201).
  - `private teams are members only, even for admins` — private team; an admin non-member gets 404 on the issue, its comments and documents; after the admin joins (team member added), 200.
  - `guests see only their teams` — guest added to OPS; public MKT team, its issues and project → 404; OPS → 200.
  - `team management needs a team owner or an admin` — team with owner A; member B gets 403 on creating a state; admin C succeeds; team with no owners: member B succeeds.
  - `workspace actions follow the role table` — guest creating a team → 403; member creating a webhook → 403; admin → 201.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/shared` — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate (`db:generate`, hand-add data updates, `db:migrate:test`), update existing tests that used roles or the matrix (rewrite to workspace roles / team owners).
- [ ] **Step 4: Run** the full API suite and root checks — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat(api)!: replace team roles with Linear's workspace roles and team visibility`

### Task 2: Workspace invites, self-join, role changes, suspension

**Files:** `packages/db` (`workspace_invite` replaces `team_invite`; `user.suspended_at`; migration moving pending invites: existing accounts → memberships, others → workspace invites), `packages/auth` (user-create hook applies a pending invite's role and teams and consumes it; sign-in and API-key checks reject suspended users), `apps/api/src/invites/` (workspace invites: create, list, revoke), `apps/api/src/members/` (team join/leave, add member, team owner flag), user admin routes (change role, suspend, unsuspend), notifications skip suspended users, `webhooks` (all-teams = public teams; private team webhook needs membership), god mode user delete owners only.

**Interfaces (Produces):** `createWorkspaceInvite({ email, role, teamIds }, inviter)`, `revokeWorkspaceInvite(id, actor)`, `joinTeam(teamId, userId)`, `leaveTeam(teamId, userId)`, `setTeamOwner(teamId, userId, owner, actor)`, `changeWorkspaceRole(userId, role, actor)`, `suspendUser(userId, actor)`, `unsuspendUser(userId, actor)`.

- [ ] **Step 1: Write the failing tests** `apps/api/src/invites/__tests__/integration/workspace-invites.test.ts` and `apps/api/src/members/__tests__/integration/roles-admin.test.ts`:
  - `an invite applies its role and teams at sign-up` — admin invites `g@x` as guest to OPS; signing up as `g@x` gives role guest and OPS membership; the invite is gone.
  - `invites cannot exceed the inviter's role` — member invites as admin → 403; admin invites as owner → 403; member invites as guest → 201.
  - `inviting an existing account is refused` — 400.
  - `anyone but a guest can join a public team` — member joins MKT (201, listed in their teams); guest → 403; private team → 404.
  - `role changes follow the table and keep an owner` — admin changes a member to guest (200); admin changes an admin → 403; demoting the last owner → 400; suspending the last owner → 400.
  - `a suspended user cannot sign in or use an API key` — suspend; sign-in fails; REST with the key → 401; unsuspend restores.
  - `all-teams webhooks skip private teams` — all-teams webhook; an issue in a private team sends no delivery; one in a public team does.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** the full API suite and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: workspace invites, team joining, role changes and suspension`

### Task 3: GraphQL

**Files:** `apps/api/src/graphql/resolvers/` (team, user, a new `membership.ts` / `invite.ts`), `mount.ts`, AGENTS.md.

- [ ] **Step 1: Write the failing tests** `apps/api/src/graphql/__tests__/integration/roles.test.ts` (SDK + raw `gql`):
  - `exposes roles on users` — `viewer.admin`, `owner`, `guest`, `active` for each role.
  - `teams follow visibility` — a member's `teams()` includes unjoined public teams, not unjoined private ones; a guest's only theirs; `team(id)` of a hidden team → ENTITY_NOT_FOUND; a guest's `users()` lists only people sharing a team.
  - `userChangeRole, userSuspend, userUnsuspend` — admin promotes member to admin → FORBIDDEN; owner does it → success; role `app` → INVALID_INPUT.
  - `team memberships` — `teamMembershipCreate({ teamId, userId, owner })` by a team manager; `TeamMembership.owner`; `teamMembershipDelete`; a member without management → FORBIDDEN on a team with owners.
  - `organization invites` — `organizationInviteCreate({ email, role: guest, teamIds })`, `organizationInvites`, `organizationInviteDelete`; role above the inviter → FORBIDDEN.
  - `teamCreate with visibility private` — `team.visibility` `private`, `private` true, creator is a team owner.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; typecheck.
- [ ] **Step 5: Commit** `feat(api): roles, team visibility, memberships and invites over GraphQL`

### Task 4: Web

**Files:** `apps/web/src`: remove the roles settings pages, role pickers and matrix UI; members page shows workspace role and team owner; workspace members page (owners/admins: change role, suspend); invite dialog (email, role, teams); team list with public teams and a Join / Leave button; team settings visibility switch; `lib/api.ts`, services, query keys, navigation; UI gating by role instead of the matrix (`viewer` on the team payload carries `workspaceRole`, `teamOwner`, `canManage`).

- [ ] **Step 1:** Update `lib/api.ts` types to the Task 1–2 REST shapes; run `bun run typecheck` — Expected: FAIL listing every web use of the removed matrix and roles.
- [ ] **Step 2:** Rework each failing place and add the pages above; grep `apps/web/src` for `roleId`, `permissions.`, `/roles` — Expected: no matches.
- [ ] **Step 3: Run** root `format:check`, `lint`, `typecheck`, `build` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(web): Linear's roles, team joining and workspace invites`

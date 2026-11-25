# Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linear's personal Favorites: a `favorite` table served through Linear's
Favorite API, a star on item pages, and a Favorites section in the sidebar with folders
and drag ordering.

**Architecture:** `apps/api/src/favorites/` holds the store (one nullable foreign key per
kind, cascading deletes) and the access check on each target. GraphQL resolvers in
`graphql/resolvers/favorite.ts`. The web gets a shared `services/favorites.service.ts`,
a shared star button in `components/common/favorites/`, and a sidebar section in
`components/layout/`.

**Tech Stack:** Bun, Elysia, graphql-yoga with Linear's vendored SDL, Drizzle/Postgres,
Next.js 15, React 19, TanStack Query, gql.tada, dnd-kit (`lib/dnd.ts`).

**Spec:** `docs/superpowers/specs/2026-11-25-favorites-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. One new migration `0063_*` via `bun run db:generate`.
- Follow `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, DESIGN.md; web features never import each other.
- A person reads and changes only their own favorites; another person's favorite id is ENTITY_NOT_FOUND.
- A favorite of something the viewer cannot see is left out of lists and its target reads null.
- Folders are not nested (INVALID_INPUT "Folders cannot be nested").
- One favorite per person and target: creating it again returns the existing one.
- Commits: one per task, Conventional Commit subject, no trailer or metadata.

## Review Focus

1. **A favorite whose item became invisible** (team made private, guest, archived issue, trashed project) never shows its name in the list or through `Favorite.issue` etc. Test in Task 1.
2. **Deleting a folder** moves its favorites to the top level, keeping their order after the existing top-level ones. Test in Task 1.
3. **Starring from two tabs at once** gives one favorite (unique index per owner and target). Test in Task 1.
4. **Customer favorites while Customers is off** are left out. Test in Task 1.
5. **Dragging a favorite into a folder and back** keeps the sparse `sortOrder` valid (no NaN, no collisions). Test in Task 2.

---

### Task 1: Favorites in the API

**Files:**
- Modify: `packages/db/src/schema/app.ts`; Create: `packages/db/drizzle/0063_*.sql`
- Create: `apps/api/src/favorites/{store,access}.ts`, `apps/api/src/graphql/resolvers/favorite.ts`, `apps/api/src/favorites/__tests__/integration/favorites.test.ts`
- Modify: `apps/api/src/graphql/mount.ts` (register resolvers), `apps/api/AGENTS.md` (Favorites paragraph, Coverage list)

**Interfaces:**
- Produces (DB): `favorite` (id, owner_id → user cascade, parent_id → favorite `on delete cascade`; the store moves a folder's children to the top level before deleting it), `folder_name` null, `sort_order real not null`, `predefined_view_type` null, and one nullable FK per kind, each `on delete cascade`: `issue_id`, `project_id`, `custom_view_id`, `cycle_id`, `document_id`, `initiative_id`, `label_id`, `project_label_id`, `customer_id`, `dashboard_id`, `team_id` (also used as `predefinedViewTeam` when `predefined_view_type` is set), `user_id` (a person). Check: exactly one of folder_name / a target FK / predefined_view_type is set (team_id may accompany predefined_view_type). Unique indexes per owner on each target column (partial, `WHERE <col> IS NOT NULL`) and on (owner, predefined_view_type, coalesce(team_id, '00000000-…')).
- Produces (API):
  - `FavoriteDto { id, ownerId, type, parentId, folderName, sortOrder, predefinedViewType, targetId: string | null, teamId: string | null, createdAt, updatedAt }`; `type` is one of `issue`, `project`, `customView`, `cycle`, `document`, `initiative`, `label`, `projectLabel`, `customer`, `dashboard`, `team`, `user`, `predefinedView`, `folder`.
  - `listFavorites(user): Promise<FavoriteDto[]>` (own, visible targets only, ordered by parent then sort_order), `getFavorite(user, id)`, `createFavorite(user, input)`, `updateFavorite(user, id, { folderName?, parentId?, sortOrder? })`, `deleteFavorite(user, id)`.
  - `visibleTargetSql(user)` in `access.ts`: one SQL condition using the existing access primitives (`visibleTeamIds`, project / initiative / document / view / dashboard / customer visibility functions already in their folders).
  - New `sortOrder` default: `max(sort_order) + 1000` among siblings. Deleting a folder moves its children to the top level after the last top-level favorite, in their order, then deletes it.
  - GraphQL: `favorites` (connection, the viewer's top level and children flat as Linear does: all of the viewer's favorites), `favorite(id)`, `favoriteCreate(input)`, `favoriteUpdate(id, input)`, `favoriteDelete(id)` → `DeletePayload`; `Favorite` fields `type`, `folderName`, `sortOrder`, `parent`, `children`, `owner`, `url` (the item's web URL; folders null; dashboard `/dashboards/<id>` on `APP_URL`), and the target fields (`issue`, `project`, `customView`, `cycle`, `document`, `initiative`, `label`, `projectLabel`, `customer`, `team`, `user`, `predefinedViewType`, `predefinedViewTeam`). Input keys outside the supported kinds (`releaseId`, `pullRequestId`, `facetId`, `liveFolderPreset`, tabs, …) → INVALID_INPUT. Guests may favorite what they can see; OAuth tokens need `read` / `write` like any query / mutation.

- [ ] **Step 1: Write the failing tests** in `favorites.test.ts`:
  - `a member favorites an issue and lists it` (`favoriteCreate({ issueId })` → `type: 'issue'`, `issue.id`, `url` ends with the issue identifier path).
  - `favoriting the same issue twice returns the same favorite`; `two concurrent creates give one favorite` (Promise.all; Review Focus 3).
  - `each supported kind can be favorited` (project, customView, cycle, document, initiative, label, projectLabel, customer, dashboardId, team, user, predefinedViewType `myIssues`).
  - `exactly one target is required` (none → INVALID_INPUT; two → INVALID_INPUT); `releaseId is not supported` → INVALID_INPUT.
  - `folders hold favorites and cannot be nested` (folder in folder → INVALID_INPUT "Folders cannot be nested"; parentId of a non-folder → INVALID_INPUT).
  - `deleting a folder moves its favorites to the top level in order` (Review Focus 2).
  - `another person's favorite is not found` (read, update, delete → ENTITY_NOT_FOUND; not in their list).
  - `a favorite of an issue in a team made private is left out` and `Favorite.issue reads null through favorite(id)` (Review Focus 1); same for a trashed project.
  - `deleting the issue deletes its favorite`.
  - `customer favorites are left out while Customers is off` (Review Focus 4).
  - `new favorites go last; favoriteUpdate sortOrder reorders`.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/favorites` — Expected: FAIL.
- [ ] **Step 3: Add the schema**, `bun run db:generate`, then `bun run db:migrate:test` (the dev database is not migrated; leave it).
- [ ] **Step 4: Implement** the store, access, resolvers and AGENTS.md text.
- [ ] **Step 5: Run** `cd apps/api && bun run test src/favorites src/graphql` — Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): favorites`

### Task 2: Favorites in the web

**Files:**
- Create: `apps/web/src/services/favorites.service.ts`, `apps/web/src/utils/favorites.ts` (+ `__tests__/favorites.test.ts`), `apps/web/src/components/common/favorites/{FavoriteStarButton,FavoriteMenuItem}.tsx`, `apps/web/src/components/layout/{SidebarFavorites,SidebarFavoriteRow,SidebarFavoriteFolder}.tsx`
- Modify: `apps/web/src/components/layout/AppSidebar.tsx` (or `SidebarMainNav.tsx`), the page headers of issue, project, view, cycle, document, initiative, customer and dashboard pages, `components/common/issue/IssueContextMenu.tsx`, `services/queryKeys.ts`

**Interfaces:**
- Consumes: Task 1 GraphQL.
- Produces:
  - `useFavorites(): Favorite[]`, `useFavoriteFor(target: FavoriteTarget): Favorite | null`, `useToggleFavorite(target)`, `useMoveFavorite()`, `useCreateFolder()`, `useRenameFolder()`, `useDeleteFavorite()`; `FavoriteTarget = { kind: FavoriteKind; id: string } | { kind: 'predefinedView'; view: string; teamId?: string }`.
  - `utils/favorites.ts`: `favoriteTree(list): { top: FavoriteNode[] }` (folders with children, both sorted by `sortOrder`), `sortOrderForDrop(siblings: number[], index: number): number` (between neighbours; ends ±1000; empty → 1000), `favoriteHref(f): string | null` (from `url`, made relative), `favoriteLabel(f, names): string` (target name; dashboards by id from the dashboards list; predefined views: "My issues", "<Team> · Active cycle").
  - `FavoriteStarButton({ target })`: a ghost icon button, `Star` filled when favorited, aria-label "Add to favorites" / "Remove from favorites".
  - Sidebar: a "Favorites" section above the workspace items when the list is not empty; rows with the kind's icon; folders collapsible (state in localStorage `sidebar.favorites.collapsed`); drag to reorder and into / out of folders (dnd-kit); folder rename and delete in a row menu; Remove on a favorite's row menu; "New folder" in the section's menu.

- [ ] **Step 1: Write the failing tests** in `utils/__tests__/favorites.test.ts`:
  - `favoriteTree nests children under folders in sortOrder`.
  - `sortOrderForDrop` cases: `([], 0) → 1000`, `([1000], 0) → 0`, `([1000], 1) → 2000`, `([1000, 2000], 1) → 1500`, and moving into an empty folder → 1000 (Review Focus 5: never NaN, strictly between neighbours).
  - `favoriteHref` makes the API's absolute URL relative to the app; folders → null.
  - `favoriteLabel` for a dashboard reads the dashboards list by id; a missing one → "Dashboard".
- [ ] **Step 2: Run** `cd apps/web && bun test src/utils/__tests__/favorites.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the utils, service, star button, menu item, sidebar section, and place the star on the eight page headers and the issue context menu.
- [ ] **Step 4: Run** `bun run format:check && bun run lint && bun run typecheck && bun run build` at the root and `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): favorites`

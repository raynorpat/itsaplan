# api (Elysia)

Elysia server on Bun, port 3000 (`API_PORT`). See root `AGENTS.md` for stack/env.
Rules and invariants for this package below; read the code for the walkthrough.

## Structure

- Feature-based: one folder per domain = `routes.ts` (controller) + `store.ts`
  (Drizzle service). Cross-cutting code in `shared/`. See `src/` for the current set.
- `app.ts` assembles and exports the app (`export const app`, no `.listen()`);
  `index.ts` only binds the port. `export type App = typeof app` types the Eden Treaty
  client (web + tests).
- `routes.ts`: `new Elysia({ name: "<feature>", detail: { tags: ["<Tag>"] } })` —
  routes chained directly on it, input validated with `t`, each route sets
  `detail.summary`.
- `store.ts`: plain async functions, no Elysia/HTTP types, returns DTOs never rows.

## Adding a route

- Chain on the same instance — never reassign to an intermediate `const` (breaks
  Elysia type inference and `type App`).
- Validate all input with `t`. Numeric path ids use `t.Numeric()`; never
  `Number(params.x)` in the handler.
- Enforce access with a guard in the route options, never an imperative call in the
  handler (see Auth and access).
- Throw `HttpError` for failures; return the store DTO on success; `noContent()` for a
  delete with no body; `set.status = 201` on create.
- New feature: `.use()` it in `planner.ts` and register its tag in the swagger
  `documentation.tags` list in `app.ts`.

## Error model

- Throw `HttpError(status, message)` for expected failures (400/404/409/413/502) —
  never hand-build error bodies. `onError` maps it to `{ error }`.
- Unique violation: wrap the insert in `rethrowDuplicate(err, "<what>")` → 409.
- `onError` also maps `t`-schema rejection → 400, `NOT_FOUND` → 404, anything else →
  500 logged with `[planner]`.

## Data invariants

- **DTOs, not rows.** `timestamptz` → `iso()` string; `numeric` → `num()`; `date` is
  already `'YYYY-MM-DD'`.
- **jsonb** (view `filters`/`display`, action `condition`/`effect`) passes through as
  JS objects — never `JSON.stringify`; validate only as `t.Any()`.
- **Sequence numbers** ("MKT-42") are issued under a row lock on `team` inside
  `createIssue`'s transaction — keep the lock so concurrent creates don't collide.
- **`position` is a sparse float** (`MAX(position) + 1000`); do not assume contiguous
  integers.
- **Deletes cascade in the DB** (every team/issue-scoped FK is `ON DELETE CASCADE`).
  `deleteIssue` still reads attachment rows first to purge their objects.
- **Object-store deletes are best-effort** — log a failed `deleteObject`, do not fail
  the request.
- **Comments are their own table** (`comment`, `comments/store.ts`) on an issue, a
  project, a project update, an initiative update or a document; replies are one level deep (a reply to a reply is
  stored under the root). `issue_activity` holds the change log only. The feeds
  (issue, range, share, team activity, project) and the revision markers
  read the `feed_entry` view, which unions both tables in
  one row shape; write comments through `createComment`, never into the view.
- **Labels** (`labels/store.ts`): a label belongs to a team or to no team (a
  workspace label). A group is a label with `is_group`; it cannot be applied or
  nested. A retired label stays on its issues but cannot be newly applied. Check
  labels with `assertLabelsApplicable` before writing them to an issue.
- **Reactions** (`reactions/store.ts`): one per user and exact emoji on a comment,
  issue, project update or initiative update.
- **Cycles** (`cycles/`): a team with cycles enabled has a cycle containing now
  (except between closing the active cycle by hand and the next cycle's start) and `upcoming_cycle_count` cycles ahead; cycles never overlap and are on UTC
  days (`schedule.ts`). The worker calls `POST /internal/cycles/tick` hourly and
  `runUpkeep(now)` closes ended cycles, moving unfinished issues into the current
  cycle through `updateIssue`, creates upcoming cycles and appends the history
  arrays. Every upkeep step works from dates, so a missed run catches up and past
  cycles are never backfilled. Tests pass a fixed `now`.
- **Initiatives** (`initiatives/`): workspace-level groups of projects
  (`initiative_to_project`, a project once per initiative) with sub-initiatives
  (`initiative_relation`: one parent, no loops, at most 5 levels). An initiative with
  a lead team is visible to users who can see that team; one without a lead team
  to every owner, admin and member (`access.ts`); guests see none. Seeing an
  initiative allows changing it. Deleting the lead team makes its initiatives
  workspace initiatives. Health is the newest unarchived `initiative_update`'s.
  `initiativeDelete` archives and sets `trashed`.
- **Issue relations** (`issues/relations.ts`): `blocks`, `duplicate` (the issue is a
  duplicate of the related one) and `related`, one per unordered pair of issues,
  across teams allowed. Every change is logged on both issues (action `relation`).
  A new duplicate moves to its team's canceled state named "Duplicate", else the
  first canceled state, unless already completed or canceled. A relation is visible
  when both issues are; writes need access to either issue's team.
- **Documents** (`documents/`): a titled Markdown page in exactly one project or
  issue. Access follows the parent: whoever can see the project or issue reads and
  writes its documents (`access.ts`). The document id is also Linear's `documentContentId`, which
  comments on the document use. `documentDelete` archives and sets `trashed`;
  documents of archived parents are hidden from lists, and a document cannot be
  created in, moved to or restored under an archived parent.
- **Attachments** (`attachments/`): Linear's `Attachment` on an issue, either a link
  or an uploaded file, in one `attachment` table. An upload has the file columns
  (all set or all null), `source_type` `upload` and `url` `/attachments/<publicId>/raw`,
  returned as an absolute URL on `API_URL`; incoming URLs on that route are
  normalised back before matching. One attachment per URL on an issue:
  `upsertLinkAttachment` updates the existing one. Every write goes through the
  store, which sends the `Attachment` webhooks; REST lists and quotas count uploads
  only. Access follows the issue's team.
- **Notifications and subscriptions** (`notifications/`): `issue_subscription` holds
  Linear's issue subscribers. Creating an issue subscribes its creator and assignee;
  a new assignee, a comment's author and the members a comment mentions are
  subscribed too (`subscriptions.ts`); only members of the issue's team are
  subscribed, listed or notified. Comment and status-change notifications go to the
  subscribers, assignment and mention notifications to the assignee and the
  mentioned members, never to the actor. An archived notification (`archived_at`)
  is left out of the inbox and the unread count; GraphQL serves every notification
  as an `IssueNotification` with Linear's type and category names, limited to the
  viewer's own on teams they are in. `subscriberIds` is accepted on `issueCreate` and
  `issueUpdate`, not on `issueBatchUpdate`.

## Auth and access

Enforced declaratively through macros, never imperative calls in handlers.

- **Session:** `authContext` (named plugin) reads the better-auth session once, puts
  `user` on context, throws 401 with none. `planner.ts` gates every planner route;
  a feature also `.use(authContext)` when its handlers/macros reference `user`. An
  `x-api-key` header resolves through `getSession` — no special-casing.
- **Linear's model** (`shared/access.ts`, the one place access is decided):
  workspace roles on the user (`user.workspace_role`: `owner`, `admin`, `member`,
  `guest`); teams are `public` or `private`; `team_member.owner` marks a team
  owner. Owners, admins and members see and work in every public team and their
  private teams; guests only in their teams (`visibleTeamIds`). Team management
  (settings, states, team labels, members, visibility, deletion) needs a team
  owner or a workspace admin, or any member when the team has no owner.
  Workspace actions follow the role table in
  `docs/superpowers/specs/2026-11-22-linear-roles-design.md` (`assertWorkspaceRole`).
  A team the user cannot see is 404; a visible team without the right is 403.
- **`:teamKey` routes:** `.use(guards)` and set `teamAccess: "see" | "manage"` or
  `teamWebhooks: true`; read the resolved `team` from context.
- **Entity-by-id routes** (`/issues/:issueId`, `/views/:viewId`, …): define a local
  macro via `entityGuard(notFound, resolveTeamId)` and set it in route options
  (e.g. `workItem: "see"`).
- Guards/macros wrap the `shared/access.ts` primitives. Handlers that still need
  `user` (team create, invites, joining, self-removal) call `requireUser(user)`.
- **Joining the workspace and teams:** people join the workspace through workspace
  invites (`invites/`, `workspace_invite`): an invite carries a role (admin, member,
  guest) and teams, applied by the better-auth user-create hook when the address
  signs up, which also deletes the invite; one pending invite per address, and an
  address that already has an account cannot be invited. Nobody invites above their
  own role. Anyone who can see a team may join it (`POST /teams/:teamKey/join`);
  any team member may add people to a public team, a team manager to a private
  one or as a team owner (`members/`).
- **Workspace administration** (`workspace/`): admins change the roles of members
  and guests and suspend them; owners act on anyone and alone make or remove
  owners; the workspace keeps at least one active owner. A suspended user
  (`user.suspended_at`) has no sessions, cannot sign in (better-auth session
  create hook), is refused on API keys (`getActiveSession`, used by REST, GraphQL
  and MCP) and receives no notifications; memberships and history stay. God mode's
  hard user delete is owner-only.
- **Projects span teams** (`project_team`), so routes that address a project use the
  `project: true` macro in `projects/routes.ts`, which resolves access through every
  team of the project (`projects/access.ts`): a project none of whose teams the user
  can see → 404. Issues may only join a project
  that includes their team; a team with issues in a project cannot be removed from it.
  Project statuses are six seeded rows (`project_status`, ids in
  `packages/db/src/project-statuses.ts`); `resetDb` keeps them.

## Security

- **`GET /attachments/:publicId/raw` is public and unauthenticated** (used in
  `<img>`/`<video>`). Preserve its defenses if you touch it: `X-Content-Type-Options:
nosniff`, forced download outside a strict media allowlist, locked-down CSP.

## Tests

`bun test` with **Eden Treaty** driving the app in memory against a real test Postgres
and real better-auth sessions — nothing is mocked. Import `app` via the helpers (from
`src/app.ts`), never `src/index.ts` (it binds the port).

**Setup.** Point tests at a dedicated `*_test` database, never dev/prod:

```bash
cp .env.test.example .env.test        # repo root; DATABASE_URL must name a *_test database
bun run db:migrate:test               # migrate it (repo root)
bun run test                          # from apps/api, or at root via turbo
```

The `test` script loads `--env-file=../../.env.test`. The attachments test also needs
RustFS + `S3_*` in `.env.test` (`docker compose -f docker-compose.dev.yml up -d` creates
the bucket); the Docker test gate starts its own throwaway RustFS.

**Layout.** Tests colocated under `__tests__/`, `integration/` (Treaty vs running app +
test DB, one file per feature) or `unit/` (pure functions, no session/HTTP/DB — import
directly). Helpers in `src/__tests__/helpers/`: `api` (anonymous client), `authedApi(cookie)`,
`signUpTestUser()` → `{ cookie, userId, email }`, `resetDb()`.

**Rules.**

- `beforeEach(resetDb)`. Build every precondition through the API, not raw inserts.
- Assert through the API (status + DTO via `toMatchObject`, side effects via a
  follow-up read), never by reading rows.
- Cover per route: happy path, one valid + one invalid per field rule, boundaries
  (empty, max/max+1, last-owner), each failure status (400/403/404/409), and the
  feature's own access wiring (who succeeds; a user who cannot see the team gets
  404). Don't re-test shared machinery — the no-session 401 and the role rules have
  their own tests in `shared/__tests__/`.
- Confirm each case goes red when the behavior is broken.

**Gotchas.**

- Assert failures on the top-level `status`, not `error.status` — Treaty narrows
  `error.status` (e.g. `422`), so `HttpError` codes (400/401/403/404) fail typecheck
  there. Read the body from `error.value`.
- A DTO date arrives as a `Date`, not a string — Treaty revives `iso()` strings on the
  client. Assert the value, not `typeof === "string"`.
- The first `signUpTestUser` in a test is the workspace `owner` (fresh DB per
  `resetDb`); later ones are `member`s. `__tests__/helpers/roles.ts` gives a user
  another role, adds them to a team and makes a team private.
- Don't hardcode ids or the "-42" sequence — read them from the create response.

## Webhooks (Linear-compatible)

Outgoing webhooks use Linear's format and subscription model, so a Linear webhook
receiver works against the instance.

- **Subscriptions** (`webhooks/store.ts`): a webhook covers one team or all teams
  (`all_public_teams`, including teams created later) and lists resource types:
  `Issue`, `Comment`, `IssueLabel`, `Project`, `ProjectUpdate`, `Reaction`, `Cycle`,
  `Initiative`, `InitiativeUpdate`, `Document`, `Attachment`. Initiative events go to the lead team's
  webhooks, or only to all-teams webhooks for a workspace initiative. Webhooks are
  managed by workspace admins and owners: a team webhook by one who can see the team,
  an all-teams webhook by any (`webhooks/access.ts`, checked on every operation). An
  all-teams webhook receives workspace-level events and events touching a public
  team; a private team's events reach only its own team webhooks.
- **Events:** the stores call `emitEvent` (`webhooks/event.ts`) after a change,
  with the entity's data from `webhooks/data.ts` before and after it. `data` is the
  GraphQL mapper's output plus Linear's relation ids; `updatedFrom` holds the
  previous values of changed fields. A label group is sent as an `IssueLabel` with
  `isGroup: true`. A project event reaches the webhooks of every team it includes;
  an update also reaches the teams it had before. One user edit sends one event
  (`updateIssue` takes `labelIds`; a project team change passes its before-data to
  `updateProject`). Issue paths check `isWatched` first, so no data is built for a
  team without webhooks. A new write path for these entities must call `emitEvent`
  too.
- **Delivery** is the worker's (`apps/worker`): it adds `webhookTimestamp`, signs
  the body and retries on Linear's schedule.

## GraphQL (Linear-compatible)

`/graphql` serves Linear's published schema so `@linear/sdk` and Linear tools work
against the instance. Code is in `src/graphql/`; it is mounted in `app.ts` with
`mountGraphql(app)` after the chain, like MCP, so `type App` stays the REST surface.

- **Schema:** `schema.graphql` is vendored unmodified (source and update steps in
  `SCHEMA_SOURCE.md`). Never edit it. The `@linear/sdk` dev dependency is pinned to
  the same release; `__tests__/unit/sdk-documents.test.ts` validates every SDK
  operation against it.
- **Auth:** `Authorization: <key>` or `Authorization: Bearer <key>` is resolved as
  `x-api-key` through better-auth (`context.ts`); a session cookie also works. No
  valid credentials → HTTP 401 with `extensions.code: AUTHENTICATION_ERROR`.
- **Unimplemented parts:** a root Query/Mutation field without a resolver answers
  `NOT_IMPLEMENTED`. Any other field without a resolver reads its parent's property
  or resolves to a neutral value by type (`schema.ts`). Add a resolver; do not
  edit the schema.
- **Writes:** mutations call the same store functions and `assertPermission`
  checks as REST (`resolvers/mutations.ts`), so activity, webhooks and
  notifications match. Store `HttpError`s map to `INVALID_INPUT` / `FORBIDDEN` /
  `ENTITY_NOT_FOUND` / `CONFLICT` (`errors.ts`).
- **Access:** the rules in Auth and access: a team and everything in it is visible
  through `visibleTeamIds`; a project through any of its teams; every workspace user
  to owners, admins and members, and to a guest only the people sharing a team. A comment or reaction follows the item it
  is on; workspace labels are visible to anyone in a team. An initiative follows its
  lead team (see Initiatives); a link or relation is listed only when both ends are
  visible.
- **Coverage:** issues, workflow states, teams (with `teamUpdate`), users, projects
  (statuses, milestones, updates, project labels), comments, reactions, issue
  labels, issue relations, documents, attachments, notifications and issue subscriptions,
  workspace roles (`userChangeRole`, `userSuspend` / `userUnsuspend`, the role flags on
  `User`), team visibility, team memberships, organization invites, `teamCreate`, cycles, initiatives (project links, sub-initiatives,
  updates) and webhooks
  have resolvers; `sort` arguments are INVALID_INPUT; the rest of the schema is neutral or NOT_IMPLEMENTED.
- **Filters and pagination:** `filter.ts` and `issue-filter.ts` list the supported
  filter fields; any other key is `INVALID_INPUT`. Connections (`connection.ts`)
  page newest first, 50 by default, 250 at most.
- **Tests:** `src/__tests__/helpers/linear.ts` serves the app on a local port and
  returns a `LinearClient`, so tests drive the endpoint with the real SDK.

## Rules

- Auth logic is in `@repo/auth`, DB access via `@repo/db` — do not re-instantiate
  either. The web app never imports these packages; it uses this API over HTTP.
- CORS `origin` is the `trustedOrigins` list exported by `@repo/auth` — do not re-parse
  `APP_URL` here.
- swagger `/docs` (planner) is separate from better-auth's `/api/auth/reference`; both
  stay reachable without a session.
- Dev: `bun run dev`. Prod: the Dockerfile migrates, then starts the server.

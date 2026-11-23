# Web on GraphQL — Stage 5.1: foundation and the issue page

Project 5 of the Linear-only app moves the web app from REST to `/graphql` area by
area and builds the pages left API-only by the GraphQL stages. Stages:

| Stage | Moves to GraphQL | New |
| --- | --- | --- |
| 5.1 | GraphQL client, the issue detail page and its feed | comments (replies, edit, delete, resolve), reactions, relations, link attachments, issue documents, subscribe |
| 5.2 | board, list, filters, saved views, bulk actions, inbox | subscribers filter, inbox archive/snooze/bulk |
| 5.3 | projects, updates, milestones, project labels | initiatives, project documents |
| 5.4 | — | cycles |
| 5.5 | team settings, members, workspace, invites, account, API keys | `lib/api.ts` deleted |

Each stage has its own design, plan, review and smoke test. New pages follow the
app's `DESIGN.md` for look and Linear for behaviour (where actions live, what a
click opens, shortcuts). Lists refresh by asking only for items changed since the
last response (`updatedAt`) every 60 seconds; a full refetch runs every 5 minutes
while the tab is visible, on returning to a tab hidden for more than 5 minutes, and
after the viewer's own create, delete or move, so items deleted or moved out of the
list by someone else disappear within 5 minutes (builder's call).

## Intent (5.1)

Lay the GraphQL foundation the later stages reuse, and move the issue page to it,
with the issue features the API has had since stages 3–8 and the web never showed.

## Goals

### Foundation

- `gql.tada` with Linear's vendored SDL (`apps/api/src/graphql/schema.graphql`) as
  the schema; queries are typed at build time; no generated-code step beyond
  `gql.tada`'s own type output, kept in the repo and checked in CI by the existing
  `typecheck`.
- `apps/web/src/lib/graphql.ts`: one `gqlRequest(document, variables)` that posts to
  `${NEXT_PUBLIC_API_URL}/graphql` with the session cookie (`credentials: 'include'`)
  and maps GraphQL errors to the web's existing error shape (`extensions.code`
  INVALID_INPUT / FORBIDDEN / ENTITY_NOT_FOUND / AUTHENTICATION_ERROR).
- Queries live in each feature's `services/*.service.ts` next to the hooks that use
  them; TanStack Query keys stay in `services/queryKeys.ts`.
- `useChangedSince` (shared hook): refetches a list with an `updatedAt: { gt }`
  filter every 60 s and merges changed nodes into the cached list; does the full
  refetch described above (every 5 minutes while visible, on returning after 5
  minutes away, after the viewer's own create / delete / move).

### Issue page on GraphQL

- Issue detail (`IssueDetail`, `IssueProperties`, `IssueDetailContent`) reads
  `issue(id)` and writes with `issueUpdate`, `issueArchive` / `issueUnarchive`,
  `issueDelete`; the issue-by-number route uses `issue(id: "KEY-N")`.
- **Every surface that reads the issue cache entry (`qk.issue(id)`) moves in 5.1**,
  so the entry holds only the GraphQL shape: the full page, the side panel opened
  from the board, the inbox's detail pane, the command palette's issue commands,
  the shell's by-number lookup and the `/issue/[issueId]` redirect. The context
  menu and the delete dialog, shared with board cards, take a small issue reference
  type (id, identifier, team key, state, the fields they show) that both the board's
  REST rows and the GraphQL issue satisfy, and run their actions through GraphQL
  mutations now (builder's call).
- The feed reads `issue.comments` and `issue.history`, merged by time on the client;
  the status timeline reads `issue.stateHistory`, and the timeline's "entries in this
  stretch" popover filters the loaded history on the client.
- **History shows Linear's level of detail** (builder's call): a description edit
  reads "updated the description" without the text; a state, label or user deleted
  later shows as removed, as in Linear. History rows written before ids were
  recorded get a best-effort backfill migration (ids matched by name within the
  issue's team at migration time). A row that still has no ids is left out of the
  feed: such rows exist only in pre-release databases, and Linear's `IssueHistory`
  has no field that could carry their kind. The status timeline keeps their
  boundaries, matching the stored state name against the team's states and
  continuing the previous state when none matches.
- Mutations on the issue page also invalidate the board's REST queries until stage
  5.2 moves the board.
- The issue's REST methods in `lib/api.ts` that no remaining caller uses are deleted
  (the board's card moves still use REST until 5.2).

### New on the issue page

- **Comments:** replies (one level, Linear's threads), edit, delete, resolve and
  unresolve a thread; mentions as today; through `commentCreate` / `Update` /
  `Delete` / `Resolve` / `Unresolve`.
- **Reactions** on the issue and on comments: emoji picker, toggle own reaction,
  grouped counts with who reacted; `reactionCreate` / `reactionDelete`.
- **Relations:** a Relations section listing blocks / blocked by / related /
  duplicate of, add (search issues) and remove; marking as duplicate shows Linear's
  hint that the issue will be closed; `issueRelationCreate` / `Delete`.
- **Link attachments:** the attachments section lists links and files together
  (`issue.attachments`), adds a link (URL, optional title), edits a title, deletes;
  file uploads move to `fileUpload` + `PUT` + `attachmentCreate`.
- **Documents:** a Documents section on the issue: list, create, open, edit (title,
  Markdown body with the existing editor), delete to trash; `documentCreate` /
  `Update` / `Delete`; comments on a document reuse the comment components.
- **Subscribe:** a subscribe toggle and a subscribers list on the issue;
  `issueSubscribe` / `issueUnsubscribe`, `issue.subscribers`.

## Non-goals

- The board, list, inbox, projects, cycles and settings (later stages).
- Issue documents as a standalone page or a documents index (opened in place from
  the issue in 5.1; a project documents list comes in 5.3).
- Real-time push (subscriptions): polling as above.

## Anti-goals

- A page that loads both REST and GraphQL for the same data, or two sources of truth
  for one cache entry.
- A regression on the issue page: everything it does today still works, except the
  history detail Linear does not have (description text in the feed; names of items
  deleted later; pre-release rows with no ids).
- Controls offered to users the API refuses (follow the roles and visibility rules;
  hide what the viewer cannot do).

## Approaches

1. **`gql.tada` typed documents + TanStack Query (chosen).** Types from the schema at
   build time, no codegen step, and the app keeps its existing query hooks.
2. **`graphql-codegen` client preset.** Rejected: a generated folder and a watch step
   for the same result.
3. **`@linear/sdk` in the browser.** Rejected: one request per relation, too slow for
   pages.

## Left to the builder

Component layout for the new sections, the emoji set, how the feed groups history
entries, how documents open (a side sheet or an in-page panel), and the order of the
work inside the stage.

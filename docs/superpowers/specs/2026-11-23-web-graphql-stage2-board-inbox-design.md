# Web on GraphQL — Stage 5.2: board, list and inbox

Follows stage 5.1 (`docs/superpowers/specs/2026-11-23-web-graphql-stage1-issue-page-design.md`),
which set up the GraphQL client, `gql.tada check`, the refresh rules and the issue page.

## Intent

Move the work-items screens (board, table, calendar, timeline), filters, saved views,
issue creation, card moves, bulk actions and the inbox from REST to GraphQL, add
Linear's inbox actions and a subscribers filter, and make whole-team issue lists fast
enough over GraphQL.

## Goals

### API: batching

- Request-scoped loaders (one `DataLoader`-style batch per request, created in the
  GraphQL context) for the fields a list of issues resolves per row: state, team,
  assignee, delegate, creator, labels, project, project milestone, cycle, parent; and
  for history and comment fields resolved per entry: actor / user, from/to state,
  user, project, cycle, labels, reactions. A whole-team issue list makes a bounded
  number of queries, not one per row and field.

### Board, table, calendar, timeline

- The team scaffold from GraphQL: `team(id: key)` with states, labels (including
  groups), members (memberships with owner), plus `viewer` (role) and the team's
  manage rights worked out as in project 2 (team owners, admins, or any member of a
  team without owners).
- Every active (non-archived) issue of the team, fetched 250 at a time until all are
  loaded, with the fields the four views use; refreshed with the stage 5.1 rules:
  changed-since every 60 s and a full reload every 5 minutes. After the viewer's own
  edits and card drags the board patches its cache from the mutation's response (no
  reload); a full reload follows only the viewer's own create, delete, archive or
  move to another team (builder's call: "move" in the 5.1 rules means moving an issue
  to another team).
- Filtering, grouping and sorting stay in the browser, over the loaded issues, as
  today.
- Saved views on GraphQL `customViews` / `customViewCreate` / `customViewUpdate` /
  `customViewDelete`, with the project 4 filter converter and view preferences for
  display.
- Writes: card moves and inline edits through `issueUpdate` (`stateId`, `sortOrder`,
  fields); creating an issue through `issueCreate`; bulk edits through
  `issueBatchUpdate` in chunks of 50; bulk archive and delete by looping
  `issueArchive` / `issueDelete`; all optimistic where the board already is, rolled
  back on error.
- A **subscribers** filter in the filter bar (is me / any of users). While it is
  active the board asks the server which of the team's issues match
  (`issues(filter: { team, subscribers: { some: { id: { in: […] } } } })`, ids only)
  and filters the loaded issues by that set; the board query itself does not select
  subscribers (builder's call).
- The archive page lists archived issues through `issues(filter: { team, archivedAt:
  { null: false } }, includeArchived: true)`.

### Inbox

- One inbox at `/inbox` for the whole workspace (Linear has no per-team inbox); the
  per-team inbox route redirects to `/inbox`.
- The inbox stays within Linear's schema (builder's call): it loads every
  unarchived notification of the viewer, paged in the background like the board
  (archiving keeps the list small), and works on the loaded list. "Unread only",
  "show snoozed" and the type filter are applied in the browser; the unread badge
  counts unread, unsnoozed notifications in that list.
- Actions: read / unread (`notificationUpdate readAt`), snooze with presets
  (`snoozedUntilAt`), archive / unarchive, and bulk actions on a selection
  (`notificationMarkReadAll`, `notificationArchiveAll`, `notificationSnoozeAll` per
  notification id or per issue). "Mark all as read" runs `notificationMarkReadAll`
  for each issue with unread notifications in the list. Linear archives rather than
  deletes, so "Delete all read" and "Delete all read for completed issues" become
  "Archive all read" and "Archive read for completed issues". The team filter goes
  (workspace-wide inbox).

### Cleanup

- `lib/api.ts` loses the team-scaffold, board-issue, create / update / bulk issue,
  view and notification methods once no caller remains; their REST routes stay for
  now (deleted in project 7).

## Non-goals

- Server-side filtering of the board (Linear filters on the server, but the web keeps
  its in-browser filtering for now; a later stage can move it).
- Projects, cycles, settings (later stages).

## Anti-goals

- A board that is slower than today's REST board for the same team, or a 60-second
  refresh that loads more than the changed issues.
- Losing an in-flight card move or edit to a refresh.
- A bulk action that half-applies without telling the user which issues failed.

## Approaches

1. **Load all active issues and keep browser-side filtering (chosen).** Same
   behaviour as today; batching makes the load cheap.
2. **Server-side filters per view through `issues(filter)`.** Rejected for now:
   reimplements grouping, sorting and counts per view and changes the board's
   behaviour; can follow later.

## Left to the builder

The loader implementation (a small helper or the `dataloader` package), page-loading
UI while issues stream in, the snooze presets, and the order of the work.

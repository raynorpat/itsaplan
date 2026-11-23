# Web on GraphQL — Stage 5.4: cycles

Follows stages 5.1–5.3 (`docs/superpowers/specs/2026-11-23-web-graphql-stage*-design.md`).
The API has served cycles since the GraphQL stage 4 (team settings, upkeep, rollover,
history arrays); the web has no cycles UI.

## Intent

Give the web Linear's cycles: team cycle settings, a cycles page per team, a page per
cycle with its issues and progress, and the cycle as an issue property everywhere
issues are edited, all on GraphQL.

## Goals

- **Team settings → Cycles** on `teamUpdate`: cycles on / off (`cyclesEnabled`),
  length in weeks (`cycleDuration`, 1–8), start day (`cycleStartDay`), cooldown
  (`cycleCooldownTime`), upcoming cycles to keep (`upcomingCycleCount`), and auto-add
  of started / completed issues to the current cycle
  (`cycleIssueAutoAssignStarted`, `cycleIssueAutoAssignCompleted`), as the API
  supports them. The REST team-settings route keeps its cycle fields until REST is
  removed in project 7; the web simply no longer uses them (builder's call).
- **Sidebar:** a **Cycles** entry under each team with cycles on.
- **Cycles page** (`/team/[teamKey]/cycles`): the current cycle (name or number,
  dates, progress) at the top; upcoming cycles; past cycles newest first with "Load
  more" (`team.cycles` / `cycles(filter)`); each links to its page.
- **Cycle page** (`/team/[teamKey]/cycles/[number]`): header with name / number, start
  and end dates, progress (scope, started, completed from `progress`, `scopeHistory`,
  `completedScopeHistory`, `inProgressScopeHistory` / issue-count histories as the API
  has them) and a small chart of those histories over the cycle's days; the cycle's
  issues in the existing list and board views (filters, grouping, sorting in the
  browser as on the team board); edit name and description (`cycleUpdate`).
- **Where a cycle page's issues come from** (builder's call): the current and
  upcoming cycles filter the team board cache in the browser, as the project Issues
  tab does, so drags, inline edits and bulk edits work unchanged. A past cycle loads
  its issues with `issues(filter: { cycle: { id } }, includeArchived: true)`; its
  non-archived issues can be edited (writes then refresh that query and the board),
  archived ones are shown read-only; any issue write refreshes cached past-cycle
  queries.
- **Cycle as an issue property:** a Cycle picker on the issue page (current, upcoming,
  none), a cycle column, card badge, filter and grouping on the team board, setting
  the cycle on a selection in bulk edit, and a Cycle field in the new-issue dialog
  (preset to the cycle when creating from a cycle page, as Linear does), through
  `issueUpdate` / `issueBatchUpdate` / `issueCreate` (`cycleId`) (builder's call).

## Non-goals

- Changing the API's cycle rules (upkeep, rollover, auto-assign), cycle-level
  comments or documents, cross-team cycle views.

## Anti-goals

- Cycle controls shown for a team with cycles off, or to users the API refuses
  (team settings need team management per project 2).
- Losing an issue's cycle when it is edited elsewhere (the board and issue caches stay
  consistent as in 5.1–5.2).

## Approaches

1. **Linear's cycles page + cycle page + issue property (chosen).**
2. **Cycles only as a board filter.** Rejected: no place for progress or past cycles.

## Left to the builder

The chart (a small SVG; no new chart library unless one is already in use), the
cycle naming ("Cycle 12" when unnamed), the page layout, and the order of the work.

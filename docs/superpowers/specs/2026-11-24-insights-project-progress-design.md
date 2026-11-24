# Insights and project progress

## Intent

Give the web Linear's two ways of reading progress: a progress graph for each project
(is it on track?) and an Insights panel on issue views (where does the work and the time
go?). Linear's schema already has the project history fields; this instance serves
placeholder project histories today and has no Insights panel.

## Goals

### Project progress

- **History on the API:** `Project.scopeHistory`, `completedScopeHistory`,
  `inProgressScopeHistory`, `issueCountHistory`, `completedIssueCountHistory` hold one
  value per day from the project's start date (its creation date when it has none) up to
  today, as Linear serves them (oldest first).
- **Scope** uses the rule cycles already use here (`apps/api/src/cycles/store.ts`):
  estimate points as soon as any non-canceled issue of the project has an estimate above
  0, an unestimated issue then counting 1; issues otherwise (teams have no estimate
  setting here) (builder's call). Canceled issues are not in scope. Completed = issues in
  a completed state; in progress = issues in a started state.
- **`Project.progress` and `Project.scope`** use the same unit and the cycles' weighting
  (a started issue counts a quarter), so the list ring, the Overview figures and the last
  history value agree (builder's call).
- **Where it comes from (user's choice):** the first time a project's history is needed
  it is rebuilt from issue history (the project and status changes recorded in issue
  activity), using each issue's current estimate for past days since estimate changes are
  not recorded; activity rows without the recorded ids (from before they were stored)
  are treated as no change, since no instance holds such data (builder's call); after that the worker appends one snapshot per project per day, as it
  does for cycles. Trashed projects are skipped; completed or canceled projects stop
  getting snapshots on the day they close.
- **Project Overview:** a progress chart under the properties: scope as a line,
  in-progress and completed as stacked areas, a dashed vertical line at the target date,
  a hover tooltip with the day's values; above it "Scope 42 · Started 12 (29%) ·
  Completed 18 (43%)" in the project's unit (points or issues).
- **Projects list:** each row shows the progress percentage with a small ring and the
  health of the latest update (On track / At risk / Off track), as Linear's list does.

### Insights panel

- An **Insights** button in the header of every issue view (team lists, project and cycle
  issue tabs, My issues, saved views) opens a panel below the list or board; the button
  toggles it; the open state is part of the view's insight settings.
- **Measures:** issue count; estimate points; cycle time (started → completed); lead time
  (created → completed); issue age (open issues, created → now).
- **Slice by:** status, assignee, priority, label, project, cycle, creator, team (team only
  where the view spans teams). **Segment by:** none or a second field from the same list.
- **Charts:**
  - count / points → horizontal bars per slice, stacked by segment; values and share;
  - time measures → per slice the median, 25th and 75th percentiles, and a scatter of
    issues by completion date (age: by creation date); clicking a dot opens the issue;
  - an "Over time" tab: issues created and issues completed per week over the period.
- **Data:** the view's issues after its filters (from the data the view already has)
  plus the issues completed in the chosen period (1, 3, 6 or 12 months; default 3)
  fetched with the view's filter and only the fields the panel needs, at most 5,000
  issues; above that the panel shows "Showing the first 5,000 issues". Computed in the
  browser (user's choice), as Linear does.
- **Click-through:** clicking a bar or slice adds that slice's filter to the view (as a
  draft change on a saved view, or the list's filter elsewhere), as in Linear.
- **Saved per view in the browser (user's choice):** measure, slice, segment, period,
  chart tab and open state are kept in this browser's storage per view (the list kind and
  its team / project / cycle, or the saved view's id). Linear's view preferences accept an
  `insights` value but no query returns it, and the SDL is not extended, so the settings
  do not follow the user to other devices.
- **Estimate points measure** is offered only when the issues in the panel's data have
  estimates.

## Non-goals

- Triage time (no Triage here), team estimate settings, Linear's Dashboards, exporting charts, insights on
  projects or initiatives lists, a server-side analytics API, recording estimate history.

## Anti-goals

- A project chart that changes its past days every time it is read (beyond the known
  estimate approximation in the backfill).
- An Insights panel that slows the list or board when closed (no fetching while closed).
- Figures that disagree with the view: the panel's counts for open issues match what the
  view shows.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Recharts
  (already a dependency) for charts. Follow the project's AGENTS.md files and DESIGN.md.
  Settle open choices the way Linear does.

## Approaches

- **Project history:** rebuilt from issue history on first need, then daily worker
  snapshots (chosen). Rejected: rebuilding on every read (past days shift with estimate
  changes; more work per read); snapshots only (no history before launch).
- **Insights:** computed in the browser from the view's data plus fetched completed
  issues (chosen, Linear's way). Rejected: a server aggregation API (no Linear schema for
  it; a round trip per change).

## Left to the builder

Storage shape of the project history (columns on `project` like cycles, or a table), the
backfill query, the worker job's place and schedule, component layout, colours from
DESIGN.md, percentile method, how the fetched completed issues are cached, and the order
of the work.

# Dashboards and the feedback report (feedback project 5)

## Intent

The team wants reports it can read at a glance and shape itself: what people outside the
workspace ask for and how fast the team answers (the feedback report), plus how the team
delivers, how projects and cycles are going and how bugs are handled. Linear does this
with Dashboards: pages of widgets built from Insights. This project adds Linear-style
dashboards and five ready-made ones, with the feedback report as the "Feedback"
dashboard. It is project 5 of the feedback programme (1 feedback and requesters, 2
portal, 3 forms, 4 outbound updates, 5 reports, 6 optional Customers).

## Goals

### Dashboards

- **Sidebar:** a **Dashboards** item (members, admins, owners; not guests) listing the
  dashboards the user can see, with **New dashboard**: blank, or from a template (below).
  Feedback → **Reports** opens the workspace's Feedback dashboard, marked as the
  workspace's feedback report (one per workspace). The first member to open Reports
  creates it from the Feedback template, shared with the workspace and owned by **no
  one**: owners and admins edit it, everyone else may duplicate it. If it is deleted,
  the next open of Reports creates it again (builder's call).
- Dashboards whose owner leaves the workspace keep working with no owner; owners and
  admins edit them (builder's call).
- **A dashboard:** name, description, owner; shared with the **workspace** (every member,
  admin and owner) or with **chosen teams** (members of those teams, plus the workspace's
  owners and admins, who see every dashboard); guests never see dashboards (builder's
  call). Sharing decides who sees the dashboard, not its data: each widget's data follows
  the viewer's access and the widget's own filter. No favorites (favorites are not
  implemented here).
- **Dashboard filters:** period (30 days, 90 days, 6 months, 12 months; default 90 days)
  and team (all or one), applied to every widget on top of its own filter; kept per user
  and dashboard in the browser, as Insights settings are (builder's call).
- **Layout:** a grid of widgets, each **half** or **full** width; **Edit** mode to add,
  configure, remove and drag widgets into order.
- **Who edits:** the owner and owners / admins of the workspace; anyone who can see a
  dashboard may **Duplicate** it into their own (owned by them, shared with the same
  audience they can choose).
- Stored by this instance (Linear's schema has no dashboard type) and managed through
  `/api/auth/instance/dashboards*` (user's choice, Approach 1).

### Widgets

- **Data:** issues, feedback requests (project 1's `CustomerNeed`), projects or cycles.
- **Filter:** for issues and feedback requests, the issue view filter (team, project,
  label, priority, status, assignee, creator, cycle; Linear's `IssueFilter`); for
  projects, status, lead, team, label and health; for cycles, team (builder's call).
- **Measure, slice and segment** as in the Insights panel, per data kind:
  - issues: the existing measures (count, points, cycle time, lead time, age, requests,
    requesters) and slices;
  - feedback requests: request count, people (distinct requesters), **time to start**
    and **time to done** (from an issue's first request to its `startedAt` /
    `completedAt`), sliced by **source** (logged by the team, portal, form), important or
    not, and the issue's team, project, label and status; plus **new people** (people
    whose first request falls in the period);
  - projects: project count and average progress, sliced by health of the latest update
    (On track, At risk, Off track, No update), status, lead or team;
  - cycles: completed scope, scope and issues carried over (Linear's
    `uncompletedIssuesUponClose`) per cycle, and the current cycle's progress.
- **Display:** a **chart** (horizontal bars by slice, stacked by segment; or **over
  time**, weekly bars or a line), a **number** (one figure with the change against the
  previous period of the same length), or a **table** (top N rows: issues, projects or
  cycles with chosen columns; N from 5 to 50).
- Clicking a bar or slice opens a side panel listing that slice's issues, feedback
  requests, projects or cycles from the rows already loaded, each opening its item;
  clicking a table row opens its issue, project or cycle (builder's call: a dashboard has
  no view to add a filter to).
- **Export CSV** in each widget's menu (user's decision): a chart exports one row per
  slice (and segment) with its values; over time, one row per week; a table its rows and
  columns; a number the figure, the previous figure and the period.

### Ready-made dashboards (templates, user's decision: all five)

1. **Feedback:** requests in the period with the change against the previous period,
   people and new people, share marked important; requests per week by source; most
   requested issues not done (people, status, days since the first request), top 20;
   median time to start and to done; delivered issues in the period and how many people
   asked for them; requested issues not started, oldest first request first.
2. **Delivery:** issues created and completed per week; cycle time and lead time by team;
   open issues by status and by priority; age of open issues.
3. **Projects:** projects by health of their latest update; table of active projects
   with progress, target date and health; target dates in the next 30 days.
4. **Cycles:** completed scope per recent cycle (last 6); issues carried over per cycle;
   the current cycle's progress per team.
5. **Bugs:** issues with the workspace's "Bug" label (case-insensitive; the template asks
   for a label when none exists): created and completed per week, open by priority,
   oldest open, median time to fix (lead time).

A template creates an ordinary dashboard the user can edit; templates themselves are
fixed in the web app (builder's call).

### Periods

Each measure has a fixed time basis (builder's call), so figures agree with the rest of
the app:
- **Current state, no period:** open issues by status / priority, age of open issues,
  active projects, the current cycle, most requested issues not done, requested issues
  not started.
- **Events in the period:** issues created / completed, requests created, people with a
  request in the period, cycle time and lead time of issues completed in the period,
  time to start / done of issues started / completed in the period (measured from the
  issue's first request, which may be earlier: the issue's own feedback is loaded for
  this), delivered issues (completed in the period with requests), cycles that ended in
  the period (Cycles: the last 6 per team).
- **New people:** people whose first request ever falls in the period; the first-request
  date comes from the People list endpoint (project 1's requesters list gains
  `firstFeedbackAt`), not from loading all feedback.
- A number widget's comparison uses the same basis over the previous period of equal
  length.

### Cycles across teams

With team "all", cycle widgets show one group per team (bars per cycle, grouped by team;
table rows with a team column), each in its team's unit (points or issues, the cycles'
scope rule) (builder's call: cycles of different teams are not added together).

### Data and access

- Widgets are computed in the browser from what the viewer may read through Linear's API
  (user's choice, Approach 1), as the Insights panel is: guests have no dashboards;
  private teams the viewer is not in are absent; two viewers may see different numbers.
- Each widget loads at most 5,000 issues (or feedback requests) for its period and filter,
  like Insights, and says "Showing the first 5,000" when cut; widgets of one dashboard
  that need the same rows share one load (builder's call).
- Nothing is fetched for a dashboard that is not open.

## Non-goals

- Scheduled dashboard emails, public dashboard links, custom formulas, widget kinds
  beyond chart / number / table, a server-side reporting API, initiatives as a data kind,
  editing templates.

## Anti-goals

- A widget showing data the viewer cannot see elsewhere in the app.
- A CSV that holds more than the widget shows (other people's emails, private-team work).
- A dashboard that slows the rest of the app or fetches while closed.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Recharts
  for charts. Follow the AGENTS.md files and DESIGN.md. Settle open choices the way Linear
  does.

## Approaches

1. **Dashboards stored by this instance, computed in the browser (chosen by the user).**
   Widgets reuse the Insights computation; data comes through Linear's API; access follows
   the viewer; one set of figures and access rules.
2. Computed on the server with a reporting endpoint. Rejected: duplicates the Insights
   logic and every access rule, and goes against the browser computation chosen for
   Insights.

## Left to the builder

Table shapes (dashboards, widgets, sharing), endpoint payloads, the widget configuration
format, how shared loads are cached, chart colours from DESIGN.md, the edit-mode
interactions, CSV column names, and the order of the work.

# Web UI like Linear

The web now runs only on GraphQL and better-auth. This project makes its screens resemble
Linear's in layout and interaction, and gives a web UI to the API features that have none.
The visual tokens in `DESIGN.md` (neutral surfaces, Inter, borderless-first) already aim
at Linear's register and stay; Linear's logo and brand assets are not used.

Screenshots of the current app (headless Chrome against a seeded test workspace) showed:
a team-first sidebar with settings scattered in it, a top bar Linear does not have, no
"My issues", a board of large cards as the default, a boxed issue page, and `/inbox`
landing on a team board.

## Stages

Each stage gets its own plan, review, and before / after screenshots.

1. **Shell** (this document, below).
2. **Issue list and board:** a dense list as the default view (one line per issue under
   status group headers), Linear's compact board cards, Linear's Display menu.
3. **Issue page:** Linear's layout (title, description, sub-issues, activity; a flat
   properties sidebar; relations and attachments inline; previous / next issue), and
   peek (open an issue over the list).
4. **Missing features in the new style:** workflow automations in team settings,
   creating and archiving cycles, archiving projects, retiring / restoring labels,
   inbox unsnooze-all and single archive, display preferences on the server
   (`viewPreferences*`), "via workflow" in history and comments, the app badge in
   project history.

## Stage 1: shell

- **Sidebar** (workspace-first, as Linear):
  - Top: the workspace menu (Settings, invite people, theme, sign out, app version),
    with buttons for search (opens the Cmd+K menu) and a new issue (C).
  - Inbox (unread count), My issues.
  - Workspace: Projects, Views, Initiatives.
  - Your teams: each team the viewer is a member of, folding open to Issues, Cycles
    (when the team has cycles on), Projects, Views. Teams the viewer can see but has not
    joined stay on the teams page (Join there).
- **Page header:** breadcrumb, view tabs, filter and display buttons. The top bar is
  removed; its search, new-issue, theme and avatar move to the sidebar and the
  workspace menu.
- **My issues** (`/my-issues`): tabs Assigned, Created, Subscribed, Activity, using the
  existing list / board views.
- **Settings** (`/settings`): one area with its own sidebar — Account (profile,
  preferences, notifications, security, API keys, authorized apps), Workspace (general,
  members, applications, MCP, project labels), Teams (each team: general, members,
  states, labels, cycles, webhooks, archive). Old settings addresses redirect to the
  new ones.
- **Names:** "Work items" becomes "Issues".
- **Keyboard:** the existing Cmd+K menu and shortcuts stay; add G then I (Inbox), G then
  M (My issues), G then P (Projects), Cmd+, (Settings).
- **Bug:** `/inbox` showing a team board is found and fixed.

## Anti-goals

- Losing a page, action or setting the app has today.
- Copying Linear's brand (logo, name, product copy).

## Approaches

1. **Restructure the existing shell components into Linear's layout (chosen).** The
   command menu, hotkeys and views already exist; the change is in layout and routing.
2. **Rewrite the web app's shell from scratch.** Rejected: more risk, nothing gained.

## Left to the builder

Component layout, icons (Lucide, as today), animation, redirect mechanics, and the
order of the work.

## Stage 2: issue list and board

- **List layout, the default:** one dense line per issue — priority icon, identifier,
  status icon, title, then right-aligned labels, project, cycle, due date, assignee,
  date; group headers with count, collapse and a + to add an issue to the group. The
  Table layout folds into List: its columns become Display properties (each field on
  or off on the row).
- **Board cards:** identifier and assignee avatar, status and title, a properties row
  (priority, labels, due date); no created / updated line.
- **Header:** breadcrumb, view tabs, filter and Display on one header line.
- **Display menu (Linear's):** Layout (List / Board), Grouping, Sub-grouping, Ordering,
  Show sub-issues, Completed issues (all / past week / past month / none), Display
  properties. Calendar and Timeline stay available as extra layouts.
- **Views:** a team Views page listing the team's saved views and a workspace Views
  page; "Views" entries in the sidebar (Workspace and each team).
- **Keyboard in the list:** J / K move, X selects, Enter opens; existing shortcuts
  stay.
- **My issues** uses the same List, with the team on each row.
- A view or board with no stored layout opens as List, Linear's default layout,
  including views saved before display preferences existed or by another client.


## Stage 3: issue page and peek

- **Header:** breadcrumb "Team › ENG-12", with the parent issue before the issue when it
  has one; up / down buttons with "3 / 15" move through the list the issue was opened
  from (J / K do the same on the page); the issue actions (copy link, copy prompt,
  archive / restore, delete, set / remove parent) sit in one "⋯" menu. Without a
  remembered list the position and arrows are hidden.
- **Main column, in order:** title, description, reactions; links and attachments as
  compact rows; sub-issues (list with "2/5", each row opening its issue, an inline
  "+ Add sub-issue" that creates a sub-issue in the team's first state); relations as
  compact rows; documents; activity with Subscribe and subscriber avatars in its
  header and the comment box at the bottom. The status timeline is removed (Linear has
  none; the activity shows each status change).
- **Sub-issue progress:** done = completed or canceled children, out of all children.
- **Parent:** set or removed from the ⋯ menu through an issue picker (the issue itself
  and its sub-issues are not offered); the API's refusal (other team, a cycle) shows
  as its message.
- **Properties sidebar:** a flat list without a card or a name column — icon and value
  for status, priority, assignee, delegate, labels, project and milestone, cycle, due
  date.
- **Peek:** Space on the focused or hovered row of a team, project or cycle list opens
  the issue in the side panel; Space or Escape closes it; J / K show the next / previous
  issue of that list and move the list's focus with it. A click opens the account's
  chosen mode, whose default becomes the full page (Linear's default). My issues has no
  peek (it spans teams and the panel belongs to one team); Space there does nothing.
- **Inbox:** the detail pane uses the same layout.

## Stage 4a: small missing features and parent history

- **Cycles page:** cycles come only from the team's cycle settings, as in Linear (its
  schema marks `cycleCreate` unsupported); "Archive" in a completed cycle's ⋯ menu
  through `cycleArchive`; a collapsible "Archived" section. The API's refusals show as
  its message.
- **Projects:** Archive / Unarchive in the project's ⋯ menu (`projectArchive` /
  `projectUnarchive`); an archived project shows a banner with Unarchive; the projects
  list has an "Archived" filter.
- **Labels (team and workspace settings):** Retire in a label's menu
  (`issueLabelRetire`); retired labels in a "Retired labels" section with Restore
  (`issueLabelRestore`).
- **Inbox:** "Unsnooze all" in the inbox ⋯ menu (`notificationUnsnoozeAll`); an archive
  button on a row on hover and `E` on the focused row (`notificationArchive`).
- **Actors:** a change or comment made by a workflow shows the workflow name with a
  workflow icon ("… · via workflow Auto-close"), from `botActor`; an app user's change
  or comment shows an "App" badge after the name (`User.app`), in issue activity,
  comments and project activity.
- **Parent history:** the API records parent changes in issue history and serves
  `IssueHistory.fromParent` / `toParent` / `fromParentId` / `toParentId`; the activity
  reads "set parent to ENG-3", "changed parent from ENG-3 to ENG-5", "removed parent
  ENG-3".

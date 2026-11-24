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

## Stage 4b: workflow automations in team settings

- **Where:** an "Automations" entry in each team's settings
  (`/settings/teams/[teamKey]/automations`), on the instance plugin's
  `/api/auth/instance/workflows*` endpoints.
- **List:** each rule with name, a one-line trigger summary, an enabled switch, run
  count, last run time and the last error; drag to reorder (rules run top to bottom);
  ⋯ menu with Archive and Delete; a collapsible "Archived" section with Unarchive and
  Delete. "New automation" only for team owners and workspace admins; each rule's
  controls only for those its edit access allows (the API's rules in
  `apps/api/src/workflows/access.ts`).
- **Editor** (`…/automations/new` and `…/automations/[id]`): name and optional
  description; When ("an issue is created" / "an issue starts matching the
  conditions"); If (the views filter builder; empty matches every new issue, the
  "starts matching" trigger needs at least one condition; a note says "Me" is the rule's
  owner); Then (actions: set status, assignee, priority, project, cycle, delegate;
  add / remove labels; add a comment); edit access for team owners and workspace admins
  only; Save / Cancel; the API's validation message shown next to the form.

## Stage 4c: display preferences on the server

- **Scope:** one personal record per list kind, Linear's view types: `allIssues` (each
  team's "All issues" list), `project` (each project's Issues tab), `cycle` (each cycle
  page), `myIssues` (My issues). Saved views keep their own preferences. Linear's
  public SDL reads personal preferences only per view type
  (`userViewPreferences(viewType)`), so a setting applies to every list of that kind.
- **Stored:** layout, grouping, sub-grouping, ordering, completed issues, show
  sub-issues, display properties and collapsed groups and swimlanes, as one
  `preferences` JSON per user and view type.
- **API:** `viewPreferencesCreate` / `viewPreferencesUpdate` accept `type: user` with
  one of the four view types and no `customViewId`; `userViewPreferences(viewType)`
  returns the viewer's record or null; one incremental migration (the saved view
  becomes optional; one record per user and view type without a saved view).
- **Web:** these lists read their preferences from the server; a list never changed
  uses Linear's defaults (List, grouped by status); a change applies at once and is
  saved in the background, with quick successive changes sent as one save; a failed
  save reverts and shows the error. The browser stores for these settings are
  removed; nothing is copied from them. My issues gets Linear's Display menu
  (ordering, grouping, completed issues, display properties). The calendar's week
  start stays a browser preference.

## Stage 4d: closing the gaps

- **Projects to the trash (Linear's `projectDelete`):** `projectDelete` archives the
  project and marks it trashed (`Project.trashed` true), as initiatives already do;
  `projectUnarchive` restores an archived or trashed project; the worker deletes a
  project 30 days after it was trashed. The web offers Delete (to the trash) in the
  project's ⋯ menu in place of Archive; the projects list's Archived tab becomes
  "Deleted" (archived or trashed projects) with Restore; a trashed project's page shows
  "This project is in the trash" with Restore. The web no longer calls `projectArchive`.
- **Deleted workflows:** deleting a workflow keeps a hidden row (`deletedAt`) so history,
  comments and notifications still resolve its name; a deleted workflow is not listed,
  read, edited or run.
- **Notifications from workflows:** a notification caused by a workflow's change stores
  the workflow; `Notification.botActor` resolves to it; the inbox row names the workflow
  with the workflow icon.
- **Workspace labels:** Settings → Workspace → Labels for owners and admins (the API's
  rule for workspace labels): create, edit, group, retire, restore and delete labels
  without a team, reusing the team labels components.
- **Browser checks:** the read-only automation editor as a second member, and the
  display-settings load error with only that request failing.

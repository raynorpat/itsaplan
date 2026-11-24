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

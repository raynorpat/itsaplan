# Portal: boards for people outside the workspace (feedback project 2)

## Intent

A software team shares boards with the people who use its product. On a board those people
see what the team is working on, vote on issues, comment and suggest new requests. Each
vote and suggestion lands in the team's workspace as feedback from project 1, so the
"N people" counts, list ordering, Insights and the People page include portal activity
without separate reporting. This is project 2 of the feedback programme (1 feedback and
requesters, 2 portal, 3 forms, 4 outbound updates, 5 reports, 6 optional Customers).

Linear has no portal; the boards, their settings and the visitor sign-in are this
instance's own. What visitors do is stored in Linear's types wherever Linear has one.

## Goals

### Boards (Settings → Workspace → Portal, owners and admins)

- A workspace has any number of **boards**. Each has a name, a URL slug
  (`/portal/<slug>`), an optional intro text and these settings:
  - **Issues shown:** a team or a project, optionally narrowed to issues with any of
    chosen labels. Only active issues (not archived, not trashed); canceled issues are
    hidden, and completed issues show for 30 days after completion (builder's call).
    Issues of private teams are never shown: a board cannot target a private team, and a
    project board leaves out its private-team issues (builder's call: a board must not
    publish what most members of the workspace cannot see).
  - **Access:** **Public** (anyone can read without signing in) or **Restricted** (only
    signed-in visitors whose email domain is in the board's domain list, or whose address
    is in its email list, can read). On a public board, voting, commenting and suggesting
    need sign-in (user's decision: no anonymous activity).
  - **Description:** shown or hidden (default hidden, since descriptions are often
    internal) (builder's call).
  - **Comments:** **Portal threads only** (default) or **All comments** (user's
    decision). See Comments below.
  - **Suggestions:** on or off; when on, the team, state and label new suggestions get
    (default label "Portal", created if missing) (user's decision for the feature;
    defaults are the builder's call).
  - **Active / disabled:** a disabled board answers "not found".
- Board pages are served under `/portal/<slug>` in the web app, without the app's sidebar
  and shell.

### What a visitor sees on a board

- **Public status** is one of *Planned* (backlog / unstarted), *In progress* (started)
  or *Done* (completed), from the issue's state type; team state names are not shown
  (builder's call).
- **Requests** tab (default): the board's issues as a list ordered by votes (Top) or by
  creation date (New), with a search box; each row shows title, public status, vote
  count and comment count, and a vote button.
- **Roadmap** tab: the same issues in three columns, one per public status.
- **Issue page** (`/portal/<slug>/<issue identifier>`): title, public status, the
  description when the board shows it, vote button and count, the comments the board's
  setting allows, and a comment box for signed-in visitors.
- **Your suggestions:** a signed-in visitor sees their own suggestions on the board even
  when the issue does not match the board's filter yet (marked "Under review").
- Visitors appear to each other by display name and avatar only; no email is shown on the
  portal.

### Visitor sign-in (Approach 1, user's choice)

- A visitor enters an email address and receives a sign-in link (the instance mail
  provider, as for members). Opening it shows a confirm page with a button (mail scanners
  must not sign people in, as in the import design); confirming creates a **portal
  session** and sets its own cookie, scoped to the portal routes.
- The visitor is project 1's **requester** (`ExternalUser`) with that email: an existing
  requester is reused (one per lowercased email); otherwise one is created on first
  sign-in, asking for a name, which fills both `name` and `displayName`. The visitor may
  change their `displayName` only; the portal shows `displayName`, the team's People page
  keeps showing `name` as the team set it (builder's call).
- On a restricted board, sign-in links are sent only to addresses the board allows; the
  page answers the same either way ("If this address has access, a link is on its way").
- Portal sessions last 30 days; signing out ends the session (builder's call).
- A portal session belongs to the requester, not to one board: it gives access to every
  restricted board the address qualifies for. Access is checked on every request, so
  removing a domain or address from a board, disabling the board or blocking the
  requester takes effect on the visitor's next request (builder's call).
- Portal sessions are accepted only by the portal routes. A member's session is never
  accepted there, and a portal session is never accepted by `/graphql`, MCP, the
  instance endpoints or any other route.
- A member's own email may sign in to the portal; there it acts only as that requester.

### Votes

- A vote is a project 1 **feedback item** (`CustomerNeed`) on the issue from the visitor's
  requester, with its attachment's source **Portal** and no quote. One portal vote per
  requester per issue; voting again removes the portal vote (unvote).
- The vote count shown on the portal is the issue's number of distinct requesters with
  active feedback (project 1's `customerCount`), so feedback the team logged counts too. A
  visitor for whom the team already logged feedback sees the issue as voted; unvoting
  removes only their portal vote (builder's call).
- Votes send `CustomerNeed` webhooks as project 1 does, and no notifications.

### Suggestions

- A signed-in visitor on a board with suggestions on enters a title and details.
  This creates an issue in the board's team, state and label, with
  `Issue.externalUserCreator` = the visitor's requester and no member creator, plus their
  feedback item on it (source Portal, quote = the details).
- Before submitting, matching issues on the board are offered ("Is it one of these?") from
  the title, to send votes to existing issues instead of duplicates (builder's call:
  Linear's similar-issues behaviour).
- A created suggestion is a normal issue creation: issue webhooks, workflow automations
  and the team's usual new-issue notifications run, as for Linear issues created from an
  intake source (builder's call).

### Comments

- A visitor's comment is a Linear **comment** on the issue with `Comment.externalUser` =
  the visitor's requester and no member author. A visitor's top-level comment starts a
  **portal thread**: its root carries Linear's `externalThread` (type `portal`, name the
  board's name, url the portal issue page on that board) and belongs to that board.
  Visitors may edit and delete their own comments.
- **Portal threads only:** a board shows the portal threads that belong to it, and all
  their replies; threads of other boards are not shown (builder's call: a restricted
  board's discussion must not appear on a public one). A member replying inside a portal
  thread replies on that board. On the issue page, members get **Post on portal** in the
  comment box (only on issues shown on a board with that setting; with several such
  boards, a board picker) to start a portal thread of their own; other comments stay
  internal.
- **All comments:** the board shows every comment on the issue except portal threads of
  other boards.
- Portal comments run like other comments: comment webhooks, workflows and notifications
  to issue subscribers (Linear notifies for synced external comments) (builder's call).
  Members see visitor comments in the issue's activity with the visitor's name and a
  "Portal" marker.
- Members may delete visitor comments as they delete any comment they can manage.
- Workspace guests, as in project 1, see no requester names: `Comment.externalUser` and
  `Issue.externalUserCreator` are null for guests, and the web shows "Portal visitor"
  (builder's call).
- Only text comments from visitors; no file uploads, reactions or mentions on the portal
  (builder's call).

### Spam and abuse

- Sign-in links: rate-limited per address and per client IP. Votes, comments and
  suggestions: rate-limited per visitor (builder's call on the numbers).
- **Block from portal** on a person's page (project 1's People page; owners and admins):
  a blocked requester's sessions end, sign-in links are refused silently, and their
  existing comments stay until deleted (builder's call).

### Workspace side

- Settings → Workspace → Portal: list of boards (name, access, issue count, link) and the
  board editor with a live link and "Copy link".
- An issue shown on a board gets a small "On portal: <board>" item in its properties with
  a link to the portal page.
- Board settings and portal administration go through the instance endpoints
  `/api/auth/instance/portal/*` (owners and admins), since Linear's schema has none.

## Non-goals

- Custom domains, theming beyond name and intro, embedding a board in another site.
- Anonymous voting or commenting, social sign-in for visitors.
- Projects or documents as portal content (boards show issues), project updates on the
  portal (project 4).
- Email notifications to visitors (project 4: outbound updates).
- Custom suggestion forms (project 3 may replace the suggestion box).
- Workspace guests reaching boards through their member session.

## Anti-goals

- A portal session that reaches any workspace data beyond its boards, or a member session
  accepted on the portal routes.
- Internal comments or descriptions shown on a board whose settings hide them.
- Revealing whether an address has access to a restricted board, or visitors' emails.
- Two requesters for one email (portal sign-in reuses project 1's requester).

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Follow
  the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.
- Portal routes are the API's own (`/portal/*`), outside better-auth, with their own
  session table and cookie (user's choice, Approach 1). The web reaches them over HTTP
  like the other routes; Origin is checked on cookie POSTs as for the instance plugin.
  As for member sign-in, the web app and the API must be on the same site (for
  example app.example.com and api.example.com) for the portal cookie to be sent.

## Approaches

1. **The API's own portal routes with a separate portal session (chosen by the user).**
   Visitors are requesters with their own session table and cookie; the routes accept
   nothing else. Pages are in the web app under `/portal/<slug>`.
2. Visitors as better-auth users with a portal role. Rejected: every visitor becomes a
   workspace user row and every check in `/graphql`, MCP and the app must exclude them;
   one missed check exposes the workspace.
3. A separate portal app on its own domain. Rejected: a new app, Dockerfile and compose
   service to run, for isolation approach 1 already gives.

## Left to the builder

Table shapes (boards, board domains/emails, portal sessions, sign-in tokens, blocks),
route paths and payloads, the session cookie's attributes across the web and API
origins, rate-limit numbers, how "similar issues" are matched, how the portal pages
fetch (SSR or client), page layout within DESIGN.md, and the order of the work.

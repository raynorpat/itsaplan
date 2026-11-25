# Requester updates and summaries (feedback project 4)

## Intent

People who asked for something hear back without having to check: when an issue they
asked for changes status, when someone replies in a portal thread they took part in, when
the team shares a project update, and in a regular summary of what happened since they
last looked. This keeps requesters informed the way Lindie's outbound updates do. This is
project 4 of the feedback programme (1 feedback and requesters, 2 portal, 3 forms, 4
outbound updates, 5 reports, 6 optional Customers).

## Goals

### Who gets updates

- A requester (project 1) gets updates only when **updates are on** for them, they have an
  email, they are not blocked from the portal and not merged into another requester.
- Updates are turned **on** when a person confirms a portal sign-in or a form submission
  (projects 2 and 3): they came to the team themselves. People the team logged by hand
  get updates only when a member turns on **Keep this person updated** on the person's
  page or in the Add feedback dialog when creating them (builder's call).
- Unsubscribing (link in every email, and the one-click header) turns all updates off,
  change emails and summaries, and records it; after that neither a sign-in nor a member
  can turn them on again; only the person can, from the portal account menu (builder's
  call: consent stays with the person).
- **Preferences** under the main switch: **change emails** on / off (default on) and the
  **summary** weekly / daily / off (default weekly); a person may keep one and stop the
  other. With the main switch off nothing is sent (builder's call).
- **Existing requesters start with updates off;** they were never told about emails. The
  portal sign-in confirm page and the form confirm page say "We'll email you about what
  you asked for. You can stop this at any time." and confirming turns updates on (unless
  the person unsubscribed) (builder's call).
- **What a person follows:** issues on which they have active feedback (a vote, a
  suggestion, a form request or feedback the team logged) and issues with portal threads
  they wrote in. Only issues in public teams that are not trashed (builder's call, as
  boards: private-team work is never sent out).
- **Access, checked on every run (builder's call):** replies are sent only from portal
  threads of boards the person can read now (project 2's access rules). Status changes
  are sent for issues the person can read on some board, and for issues where they have
  feedback from a form or logged by the team even when no board shows them (title and
  status only, no link). Votes on an issue the person can no longer read stop producing
  emails.

### What changes are sent (Approach 1, user's choice)

- A worker job, every 2 minutes, asks the API to collect, for each person with updates on,
  what changed on what they follow since their last email, read from what the app
  already records (issue history and comments):
  - **Status:** the issue moved to another public status (project 2: Planned, In progress,
    Done), or was canceled ("Closed"; "Closed as a duplicate of <title>" when Linear's
    duplicate relation exists, with a link when the person can read the other issue).
    Leaving triage counts as a change from "Under review". Reopening is sent as the new
    status ("Reopened: In progress"). Moves within one public status are not sent
    (builder's call).
  - **Replies:** new comments by others in portal threads the person wrote in (project 2
    portal threads: visitor comments and the team's replies in them). Internal comments
    are never sent.
  - **Project updates the team shared** (below).
- A person with something new gets **one email** listing all of it, at most one such email
  per 10 minutes (user's decision: soon, grouped). A per-person marker records what was
  already sent, so a change is sent once.
- Each item links to the issue's portal page on a board the person can read; without one,
  no link (builder's call).

### Project updates

- When posting a project update, the composer has a **Send to requesters** switch, off by
  default (builder's call: updates are often written for the team). Turned on, it marks
  the update shared through an instance endpoint (Linear's `ProjectUpdateCreateInput` has
  no such field), and the next run sends it to every person with updates on who follows
  an issue of that project. The email holds the update's text and health ("On track",
  "At risk", "Off track"). Editing a shared update does not send it again (builder's
  call).

### Summaries

- **Email summary:** weekly by default (Mondays, 08:00 UTC), and only when something is
  new since the last summary. A summary is a round-up of everything since the previous
  summary, including changes a change email already sent; it keeps its own marker
  (builder's call: the no-repeat rule is for change emails). Each person chooses weekly, daily or off in the portal
  account menu and on the unsubscribe page (user's decision for the cadence; times are
  the builder's call).
- **On the portal:** a signed-in visitor sees "Since your last visit" at the top of a board
  when something changed on what they follow since their previous visit (a visit is
  recorded at most once an hour).
- **How it is written (user's decision):** by default a round-up built from the same
  changes ("Dark mode moved to In progress · 2 new replies on Export to CSV · Mobile app
  is On track"). When an admin has set up an AI endpoint, a short paragraph written by
  the model from those same changes, with the round-up list kept under it. On any model
  error or after 20 seconds the round-up alone is used.

### AI endpoint (Settings → Workspace → AI, owners and admins)

- An **OpenAI-compatible** chat completions endpoint (user's decision): base URL, API key
  and model name, plus a Test button. Works with OpenAI, Claude's OpenAI-compatible API,
  Ollama and other compatible servers. The key is stored encrypted, as the mail
  provider's credentials are, and never shown again after saving.
- Only what the person may see is sent to the model: issue titles, public statuses,
  comments from their portal threads and shared project updates. Never internal
  comments, descriptions of issues on boards that hide them, or other people's emails.
- The portal summary is generated at most once a day per person; email summaries once per
  email (builder's call, to bound cost).
- Through the instance endpoints `/api/auth/instance/ai*` (Linear's schema has no setting
  for it).

### Emails

- Sent through the instance mail provider, as member notifications are; with no provider
  set up nothing is sent and nothing is marked sent.
- Every email has an unsubscribe link and the one-click `List-Unsubscribe` headers (RFC
  8058). The unsubscribe page has a button (mail scanners must not unsubscribe) and the
  summary cadence choice.
- Plain wording, the team's workspace name as the sender name; no tracking pixels.

## Non-goals

- Slack, SMS or push; per-issue mute; emails to workspace members (they have Linear's
  notifications); AI anywhere else in the app; storing model replies beyond the cached
  portal summary; letting visitors reply by email.

## Anti-goals

- Emailing someone who never asked and was not opted in by the team, or after they
  unsubscribed.
- Internal comments, private-team work or hidden descriptions in an email or sent to the
  model.
- More than one change email per person per 10 minutes, or one change in two change
  emails.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Follow
  the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.
- The worker schedules; the API reads, renders and sends (the worker never holds mail or
  model credentials), as for notification delivery.

## Approaches

1. **Read from recorded activity on a schedule (chosen by the user).** One "what changed
   since" lookup over issue history and comments serves the change emails, the summaries
   and the portal; a change made anywhere (app, workflows, API, MCP, imports) is seen.
2. Record an event at each place that changes a status or posts a reply. Rejected: every
   write path needs a hook, a missed one sends nothing, and summaries would still need
   the lookup.

## Left to the builder

Table shapes (per-person markers and preferences, shared updates, AI settings, cached
portal summary), endpoint paths and payloads, the email layout, the prompt, the job's
batch sizes, and the order of the work.

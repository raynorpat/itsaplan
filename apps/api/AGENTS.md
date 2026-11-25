# api (Elysia)

Elysia server on Bun, port 3000 (`API_PORT`). See root `AGENTS.md` for stack/env.
Rules and invariants for this package below; read the code for the walkthrough.

## Structure

- The instance's data API is `/graphql` (Linear's schema, `src/graphql/`). There is no
  REST data API. Besides GraphQL the app serves better-auth (`/api/auth/*`), MCP
  (`/mcp`, `/mcp/readonly`), Linear's OAuth paths and discovery documents
  (`oauth/routes.ts`), the health check (`GET /`), the file routes (`PUT /uploads/:token`,
  `GET /uploads/:id/raw`, `GET /avatars/:id/raw`, `GET /attachments/:publicId/raw`),
  the worker's internal routes (`/internal/*`, the `x-worker-token` secret) and the
  portal's visitor routes (`/portal/*`, see Portal visitors).
- Feature-based: one folder per domain with a `store.ts` (Drizzle service) that the
  GraphQL resolvers, MCP (through GraphQL), the instance plugin handlers and the
  internal routes call. Cross-cutting code in `shared/`. See `src/` for the current set.
- `app.ts` assembles and exports the app (`export const app`, no `.listen()`);
  `index.ts` only binds the port.
- `store.ts`: plain async functions, no Elysia/HTTP types, returns DTOs never rows.

## Error model

- Stores throw `HttpError(status, message)` for expected failures
  (400/403/404/409/413/502) — never hand-build error bodies. GraphQL maps it to
  Linear's error codes (`graphql/errors.ts`); the plain HTTP routes map it to
  `{ error }` (`shared/http-errors.ts`).
- Unique violation: wrap the insert in `rethrowDuplicate(err, "<what>")` → 409.
- `shared/http-errors.ts` also maps `t`-schema rejection → 400, `NOT_FOUND` → 404,
  anything else → 500 logged with `[api]`.

## Data invariants

- **DTOs, not rows.** `timestamptz` → `iso()` string; `numeric` → `num()`; `date` is
  already `'YYYY-MM-DD'`.
- **jsonb** (a view's `filter_data`, view preferences) passes through as JS objects —
  never `JSON.stringify`; validate only as `t.Any()`. GraphQL input objects have no
  prototype: copy them into plain objects before storing (`JSON.parse(JSON.stringify(x))`).
- **Saved views** (`views/`, Linear's `CustomView`): a team's named view. `filter_data`
  is Linear's `IssueFilter` and the only stored filter (the web converts its filter
  bar's set with `apps/web/src/utils/viewFilters.ts`); the layout and display are the
  view's `view_preferences` (`organization` defaults, `user` overrides). A `user` row
  without a saved view is the user's own preferences for a list kind (`allIssues`,
  `project`, `cycle`, `myIssues`, `projects` for the projects list; one per user and view
  type), read through
  `userViewPreferences(viewType)` and readable and changeable only by that user. A shared view
  is visible, and changeable, by anyone who can see its team; a non-shared view only by
  its owner, who is always its creator.
- **Sequence numbers** ("MKT-42") are issued under a row lock on `team` inside
  `createIssue`'s transaction — keep the lock so concurrent creates don't collide.
- **`position` is a sparse float** (`MAX(position) + 1000`); do not assume contiguous
  integers.
- **Deletes cascade in the DB** (every team/issue-scoped FK is `ON DELETE CASCADE`).
  `deleteIssue` still reads attachment rows first to purge their objects.
- **Object-store deletes are best-effort** — log a failed `deleteObject`, do not fail
  the request.
- **Comments are their own table** (`comment`, `comments/store.ts`) on an issue, a
  project, a project update, an initiative update or a document; replies are one level deep (a reply to a reply is
  stored under the root). `issue_activity` holds the change log only (GraphQL's
  `Issue.history` / `Project.history`); write comments through `createComment`.
- **Labels** (`labels/store.ts`): a label belongs to a team or to no team (a
  workspace label). A group is a label with `is_group`; it cannot be applied or
  nested. A retired label stays on its issues but cannot be newly applied. Check
  labels with `assertLabelsApplicable` before writing them to an issue.
- **Reactions** (`reactions/store.ts`): one per user and exact emoji on a comment,
  issue, project update or initiative update.
- **Cycles** (`cycles/`): a team with cycles enabled has a cycle containing now
  (except between closing the active cycle by hand and the next cycle's start) and `upcoming_cycle_count` cycles ahead; cycles never overlap and are on UTC
  days (`schedule.ts`). The worker calls `POST /internal/cycles/tick` hourly and
  `runUpkeep(now)` closes ended cycles, moving unfinished issues into the current
  cycle through `updateIssue`, creates upcoming cycles and appends the history
  arrays. Every upkeep step works from dates, so a missed run catches up and past
  cycles are never backfilled. Tests pass a fixed `now`.
- **Initiatives** (`initiatives/`): workspace-level groups of projects
  (`initiative_to_project`, a project once per initiative) with sub-initiatives
  (`initiative_relation`: one parent, no loops, at most 5 levels). An initiative with
  a lead team is visible to users who can see that team; one without a lead team
  to every owner, admin and member (`access.ts`); guests see none. Seeing an
  initiative allows changing it. Deleting the lead team makes its initiatives
  workspace initiatives. Health is the newest unarchived `initiative_update`'s.
  `initiativeDelete` archives and sets `trashed`.
- **Issue relations** (`issues/relations.ts`): `blocks`, `duplicate` (the issue is a
  duplicate of the related one) and `related`, one per unordered pair of issues,
  across teams allowed. Every change is logged on both issues (action `relation`).
  A new duplicate moves to its team's canceled state named "Duplicate", else the
  first canceled state, unless already completed or canceled. A relation is visible
  when both issues are; writes need access to either issue's team.
- **Documents** (`documents/`): a titled Markdown page in exactly one project or
  issue. Access follows the parent: whoever can see the project or issue reads and
  writes its documents (`access.ts`). The document id is also Linear's `documentContentId`, which
  comments on the document use. `documentDelete` archives and sets `trashed`;
  documents of archived parents are hidden from lists, and a document cannot be
  created in, moved to or restored under an archived parent.
- **Attachments** (`attachments/`): Linear's `Attachment` on an issue, either a link
  or an uploaded file, in one `attachment` table. An upload has the file columns
  (all set or all null), `source_type` `upload` and `url` `/attachments/<publicId>/raw`,
  returned as an absolute URL on `API_URL`; incoming URLs on that route are
  normalised back before matching. One attachment per URL on an issue:
  `upsertLinkAttachment` updates the existing one. Every write goes through the
  store, which sends the `Attachment` webhooks; the team quota counts uploads only. Access follows the issue's team.
- **Feedback** (`feedback/`, Linear's `CustomerNeed`): feedback on an issue from a
  person outside the workspace. The person is a requester (`external_user`, Linear's
  `ExternalUser`; one per lowercased email, merged ones point at the one kept) and is
  the `externalUserCreator` of the feedback's source attachment (`source_type`
  `feedback`, made by `createRequesterAttachment`, since Linear's attachment input
  cannot name one); `body` is the quote, `priority` 1 marks it important. Owners,
  admins and members who can see the issue's team read and write it; guests (and app
  users) see no feedback and no requester (`Issue.needs` empty, `customerNeed` not
  found, feedback source attachments left out of every attachment read and of
  `IssueFilter.attachments`, `feedbackAttachmentsVisibleSql`) and cannot write it, but
  get the counts: the filters and sorts, and the number of people asking on an issue
  from `/api/auth/instance/feedback/count` (`feedbackPeopleCount`; anyone who can see
  the issue; the number only). A quote is at most 10,000 characters. `customerCount` /
  `customerImportantCount` (filter and `sort`, `customerCountSql`) count, while
  Customers is on, the distinct customers of an issue's active feedback (with
  important feedback), each person without a customer once and each feedback item with
  neither once; while Customers is off, the distinct requesters (feedback without a
  requester is not a person). Moving feedback to another issue moves
  its attachment in the same transaction; deleting it deletes the attachment unless
  kept; deleting its source attachment (`attachmentDelete`) deletes the feedback;
  deleting the issue deletes its feedback and sends a `CustomerNeed` remove event for
  each. Feedback notifies no one and runs no automation; the store
  sends `CustomerNeed` webhooks. Requesters are found, created, edited and merged
  through the instance plugin (`/api/auth/instance/requesters*`,
  `feedback/requesters.ts`; owners, admins and members, merge for owners and admins; a
  merge locks both people and is refused when either was merged meanwhile; renaming or
  merging re-titles the source attachments with Attachment update events), and
  a member's feedback gets its source attachment from `/api/auth/instance/feedback/attachment`.
  Creating a requester with an email that a requester already has (or had before a
  merge) returns that requester. Merging A into B points A's feedback attachments at B
  (so B counts once per issue) and keeps A's row with `merged_into_id`, so a link or
  email of A leads to B; B takes A's email when it has none.
- **Customers** (`customers/`, Linear's `Customer`, `CustomerStatus`, `CustomerTier`):
  an optional feature, off by default (`organization.customers_enabled`, set with the
  revenue currency through `/api/auth/instance/customers-settings*`, owners and admins;
  `Organization.customersEnabled` / `customersConfiguration`). The first time it is
  turned on, the statuses Active (the default), Prospect and Churned are created. While
  off, customer queries return nothing, `CustomerNeed.customer` and a requester's
  customer read null, the `customer` need filter matches nothing, customer mutations are
  INVALID_INPUT "Customers are not enabled", and boards with Customer access are not
  served; the data is kept. Owners, admins and members create, edit, merge and delete
  customers; owners and admins manage statuses and tiers; guests and app users see
  none. Domains are lowercased, unique across customers and never a public email domain
  (`customers/domains.ts`); external ids are unique; uniqueness is checked under an
  advisory lock. There is no archive (`archivedAt` is always null). Deleting a status
  moves its customers to the default status (lowest position; the last status cannot be
  deleted); deleting a tier clears it; `customerUpsert`'s `tierName` creates a missing tier
  only for owners and admins, after the rest of the input is valid. `customers` takes
  Linear's `sorts` (name, createdAt, revenue, size, owner, status, tier,
  approximateNeedCount; one field per entry; forward paging by offset).
  `approximateNeedCount` is the number of active issues in teams the viewer can see with
  the customer's active requests (request loaders batch it, the status and the tier).
  `/api/auth/instance/customers/people-counts` gives the number of people of each
  customer. `customerMerge` moves the source's requests,
  people, domains, external ids and portal boards to the target and deletes the source;
  deleting a customer clears it from its people, requests and boards. `Customer`
  webhooks go to all-teams webhooks. A requester belongs to at most one customer
  (`external_user.customer_id`, with `customer_source` `domain` or `manual`, set and
  cleared together): a member's pick (`/api/auth/instance/requesters/customer`) wins;
  otherwise the customer whose domains hold the email's domain exactly (`matchPeople`,
  run on every person and customer write and when Customers is turned on). A request
  (`customer_need.customer_id`) with a requester always has the requester's customer
  (a different `customerId` is INVALID_INPUT) and moves with it; one without a
  requester keeps the customer it was given. These moves are one UPDATE
  (`syncNeedCustomers`): no `CustomerNeed` webhooks, `updated_at` unchanged.
- **Portal boards** (`portal/`, `portal_board`): a board shows (`shows`) either the
  active issues of one public team or one project (its public-team issues only)
  (`issues`), or the active issues of public teams with an active request from the
  board's customer (`customerRequests`, Customer access only, no team or project);
  narrowed to any of its labels when it has some, whose state has a public status
  (`portal/status.ts`: planned, in progress, done; triage and canceled issues and issues
  completed more than 30 days ago are not shown). A board cannot target a private team.
  Access (`portal/access.ts`) is `public`, `restricted` (email domains and addresses)
  or `customer` (`customer_id`: people whose current customer it is; a board whose
  customer was deleted is read by no one; Customers must be on to set it, except on a
  disabled board, which is not served). On a board
  with Customer access the vote count is the board customer's people asking
  (`boardVotesSql`), and threads show only when their root is by a member or one of the
  customer's people, without comments by people outside the customer
  (`boardCommentsSql`). Owners and admins manage
  boards through `/api/auth/instance/portal/*` (`portal/admin.ts`); a board with
  suggestions gets the suggestion team's "Portal" label unless another is chosen.
- **Portal visitors** (`portal/session.ts`, `portal/routes.ts`): people outside the
  workspace use the boards through the API's own `/portal/*` routes, not better-auth.
  A visitor asks for a link on a board (`POST /portal/auth/link`, always `{ ok: true }`;
  mailed only when the address may read the board (`addressMayRead`: on a customer
  board, the email's domain is one of the customer's or the address's person is linked
  to it) and its requester is not blocked;
  logged as `[portal] sign-in link for` when no mail provider sends it). The mail is
  sent after the response, so its timing tells nothing either. Limits
  (`portal/rate-limit.ts`, in memory per process): 5 links per address an hour (over
  it the same answer and no link) and 20 per client IP (429). The client IP is the
  connection's address, or `X-Forwarded-For` / `X-Real-IP` only when `TRUST_PROXY=true`.
  The
  link opens the web's confirm page; its button posts the token (`/portal/auth/confirm`,
  once, 15 minutes, stored hashed), which creates the requester on first sign-in (400
  `name required` without a name, the token left usable) and sets the
  `portal_session` cookie (HttpOnly, SameSite=Lax, Path=/portal, 30 days, stored
  hashed in `portal_session` with the address that confirmed the link). The cookie is
  read only by `/portal/*`, and a better-auth session or API key means nothing there.
  Like member sign-in (SameSite=Lax), it needs the web app and the API on the same
  site (e.g. app.example.com and api.example.com). A visitor changes only their
  `displayName` (the team's `name` stays). Restricted board access
  (`portal/access.ts`) is checked on every request against the session's address, not
  the requester's current email, and Customer access against the requester's current
  customer; changing a requester's email or merging requesters ends the sessions of the
  people involved. Blocking a requester
  (`/api/auth/instance/portal/block`, owners and admins) ends their sessions and stops
  their links. Every `/portal/*` POST needs an `Origin` in `trustedOrigins` (403).
- **Portal board actions** (`portal/issues.ts`, `votes.ts`, `suggestions.ts`): a
  visitor reads a board's issues (Top by votes or New, title-word search, detail with
  the description only when the board shows it) and, signed in, their own suggestions
  the board does not show yet (`underReview`). A board, or an issue on it, the visitor
  may not read is 404. A vote is a `CustomerNeed` from the visitor's requester with a
  source attachment whose `metadata.source` is `portal` and no quote, at most one per
  person and issue (`addPortalVote` / `removePortalVotes` in `feedback/store.ts`: one
  transaction with an advisory lock per person and issue, every query on its own
  connection, events after the commit); the vote count is the
  issue's people asking (team-logged feedback counts, and makes the visitor "voted"),
  and unvoting deletes only portal votes without a quote. A suggestion creates an
  issue in the board's suggestion team, state and label with
  `issue.external_user_creator_id` (GraphQL `Issue.externalUserCreator`, null for
  guests) and no member creator, plus the visitor's portal feedback quoting the
  details; it runs as any issue creation. An issue submitted from a board (a
  suggestion or a form) records it in `issue.portal_source_board_id`; a visitor's
  under-review issues are their own issues from that board in a public team. Similar issues match any title word of two
  characters or more, more matching words first. Votes 60 and suggestions 10 per
  visitor an hour.
- **Portal comments** (`portal/comments.ts`): a visitor's comment is a `comment` with
  `external_user_id` (GraphQL `Comment.externalUser`, null for guests) and no user; it
  sends the Comment webhook (`externalUserId`) and notifies the issue's subscribers like
  any comment, and starts no agent session; mentions in it are ignored. A root comment written on a board (by a
  visitor, or by a member through `/api/auth/instance/portal/comment`, only on a board
  showing the issue with `comments: 'portal'`) starts a portal thread of that board
  (`portal_board_id`, `portal_thread`, `Comment.externalThread` of type `portal`); a
  deleted board's threads keep `portal_thread` and no board shows them; a reply belongs to its
  root's thread, so a member's `commentCreate` reply in a portal thread is on the
  portal. A board shows its own threads (`comments: 'portal'`) or every comment except
  other boards' threads (`'all'`) (`boardCommentsSql`); a visitor replies only into a
  thread the board shows and edits or deletes only their own comments on issues the
  board still shows. A member without a name appears as "Team". At most 10,000
  characters, 30 comments per visitor an hour.
- **Templates** (`templates/`, Linear's `Template`): issue templates only (`type`
  `issue`; other types are INVALID_INPUT). A template belongs to a team or to the
  workspace (no team); team templates are seen by whoever sees the team, workspace
  templates by anyone who sees a team. `template_data` (`templates/data.ts`, checked on
  every write) holds the title, Markdown description, state (team templates only),
  labels (the team's or workspace labels; workspace labels only on a workspace
  template), priority 0–4 and form fields (`shortText`, `longText`, `select`,
  `multiSelect`, `checkbox`; at most 50 fields and 50 options each; unique ids; one
  `title` role on a short text field and one `quote` role on a long text field; an
  option may add a label and set a priority); unknown keys are refused. A team
  template is managed by the team's members and by workspace admins and owners, a
  workspace template by admins and owners; guests and app users manage none
  (`assertTemplateManage`); a template that is a form only by admins and owners, and its
  team cannot be changed (INVALID_INPUT).
  `templates` is the viewer's whole list, `templateSearch` takes the filter,
  `Team.templates` and `Organization.templates` (workspace templates) page.
- **Forms** (`forms/`): a team issue template of a public team with a `form_settings`
  row (slug for `/forms/<slug>`, intro, link on or off, the portal boards it is shown
  on: team boards of its team or project boards whose project includes it). Owners and
  admins manage the settings through `/api/auth/instance/forms*` (`forms/admin.ts`;
  `validateOnly` checks the settings, for a new form by `teamId`, and stores nothing);
  deleting the form deletes its template. A form whose template is archived or whose
  team is private is not found (`getFormBySlug`). Answers (`validateAnswers`) are keyed
  by field id: required questions answered, options only from the field, text at most
  10,000 characters. `submitForm` creates the issue in the template's state (else the
  team's default column), with the template's labels and the chosen options' labels
  that still apply, the last chosen option's priority (else the template's), the title
  answer (else "<form name> from <requester name>"; at most 255 characters), the
  template description followed by each answered question (`formIssueDescription`), the
  requester as `externalUserCreator`, the board's project and the source board; then the
  requester's feedback (source `form`, subtitle "Form: <name>", quote = the quote
  answer). It runs as any issue creation.
- **Public forms** (`forms/public.ts`, under the portal routes): `GET /portal/forms/:slug`
  serves a form whose link is on (options without their labels and priority). Someone
  not signed in to the portal submits with email and name (`POST /portal/forms/:slug`):
  the answer is always `{ status: 'pending' }`, given before the rest runs (so its timing
  tells nothing either), and only an address that is not blocked and within the sign-in
  link limit (shared with portal sign-in links) gets a `form_submission` row (token
  stored hashed, 24 hours, once) and the mailed link listing the answers
  (logged as `[portal] form confirmation link for` when no mail provider sends it); 20
  submissions per client address an hour (429). The link opens the web's confirm page,
  which shows the stored answers (`confirm-info`); its button posts the token
  (`/portal/forms/confirm`): it checks the form still takes requests (link on, team
  public, a state for the issue), the stored answers still fit it (answers to removed
  questions are dropped) and the requester is not blocked before claiming the token,
  then creates the requester when new, the issue and its feedback, and a portal session
  for the address; if that fails after the claim, the token is released and a requester
  it created is removed. A signed-in visitor's
  submission is created at once. On a board, `GET /portal/boards/:slug/forms` lists the
  forms placed on it that still fit it (`boardMayShowForm`), and only signed-in
  visitors submit (`POST /portal/boards/:slug/forms/:formSlug`; the issue records the
  board and a project board's project). Signed-in submissions share the suggestions
  limit. Expired submissions are deleted when a new one is stored. The slugs `confirm`
  and `confirm-info` are reserved.
- **Requester email updates** (`updates/`): a requester gets email updates only while
  `updates_enabled` is on. Confirming a portal sign-in or a form turns it on
  (`optIn`); a member turns it on or off (`/api/auth/instance/requesters/updates`), but
  not on for a person who unsubscribed (409). Turning it on starts the change and
  summary windows at that moment, on the database's clock (which stamps history and
  comments). The person sets `change_emails` and the summary
  cadence (`weekly`, `daily`, `off`) on `/portal/me/updates`; the person turning updates
  off there counts as unsubscribing. Unsubscribe links carry `<requesterId>.<HMAC-SHA256>`
  under a key derived from `BETTER_AUTH_SECRET` with HKDF (info `unsubscribe`;
  `updates/unsubscribe.ts`, no expiry; a merged person's link acts on the person kept):
  `GET /portal/unsubscribe` shows the masked address and preferences, `POST
  /portal/unsubscribe` turns everything off (or, with `summary`, changes only the
  cadence), and `POST /portal/unsubscribe/one-click` (RFC 8058) does the same without
  an Origin or cookie; unsubscribing records `updates_unsubscribed_at`, after which only
  the person turns updates on again. A merge keeps either person's unsubscribe on the
  person kept.
- **Requester changes** (`updates/changes.ts`): `requesterChanges(id, since, until)` is
  the one "what changed" lookup, read from `issue_activity` (status changes by state
  id: the status before the first and after the last change in the window, so a change
  undone within it, or a move within one status, is nothing), `comment` (replies by
  others in portal threads the person wrote in), `project_update_share` and
  `issue_to_release` (an issue that shipped in the window, "Shipped in <release>",
  from production pipelines only; a shipment already sent at or before the window's
  start, recorded in `requester_shipped` when a change email or summary with it is
  marked sent, or as of the visit when "Since your last visit" shows it, is not news
  again, so a reopened and completed issue ships once). A person
  follows the issues of their active feedback and of their portal threads, active and
  in a public team. Access is the person's at `until`: a status change or a shipment
  when an enabled
  board their email may read covers the issue (its team or project and labels, whatever
  the status) or when they have form or team-logged feedback on it; a reply only from a
  thread of such a board, and only one the board shows (`boardCommentsSql`: on a board
  with Customer access, nothing by people outside the customer). Statuses: planned, in progress, done (however long ago),
  closed (canceled, with the duplicated issue when one is related). Links go to the
  first readable board, by name, showing the issue. `requestersWithChangesSince` lists
  the people with updates on, an email, not blocked or merged, who may have something
  new (through their feedback or their portal threads). "Send to requesters" on a
  project update is `/api/auth/instance/project-updates/share` (`updates/share.ts`; the
  author or an admin, not guests; once); `GET /api/auth/instance/project-updates/shared?projectId=`
  lists a project's shared update ids for members.
- **Requester change emails and summaries** (`updates/run.ts`, `render.ts`): the worker
  calls `/internal/requester-updates/changes` every 2 minutes and
  `/internal/requester-updates/summaries` every 15, without waiting for them in its
  tick and never two of one job at once. A run's clock is the database's `now()`, and
  it covers changes up to 30 seconds before it (a change still being committed goes to
  the next run). A change email lists every change since the person's
  `changes_sent_until`, at most one per person per 10 minutes (`last_change_email_at`),
  sent once their latest change is 5 minutes old or their first unsent one 30 minutes
  old; ready people with nothing new have their window moved on. A summary (weekly:
  Mondays, daily: every day, 08:00 UTC) is the round-up since `summary_sent_until`,
  including changes a change email already sent, and only when there is something;
  after the AI endpoint fails once in a run, the rest of the run uses the round-up.
  Each person is claimed by a conditional UPDATE on their own marker (by range, not an
  exact value) before anything is sent, no transaction is held while sending, a failed
  send or any error puts the claim back so the next run sends the same changes, and one
  person's error does not stop the run. A crash between a send and its mark, or a failed
  mark (logged), can repeat that email. Without a mail provider nothing is
  sent or marked. Every email carries the unsubscribe page link and the RFC 8058
  `List-Unsubscribe` / `List-Unsubscribe-Post` headers (the one-click URL on `API_URL`),
  is sent with the workspace name as the sender name, and has no images.
- **AI summaries and "Since your last visit"** (`updates/ai.ts`, `visits.ts`): owners
  and admins set an OpenAI-compatible chat completions endpoint (base URL without a user
  name, password or query string, model, API key) through `/api/auth/instance/ai` (GET,
  without the key), `/ai/save` (an empty key keeps the stored one, only for the same
  host: a new host needs the key again), `/ai/delete` and `/ai/test`. One `ai_settings` row; the key is
  sealed with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET`
  (`shared/secret-box.ts`; rotating the secret means entering the key again) and never
  returned. `aiSummary` sends the model only the `Change` facts (titles, public statuses,
  the person's portal-thread replies, shared project updates) and the display name,
  never emails or internal comments; an error, a reply outside 1–2,000 characters or 20
  seconds without an answer gives null, and the summary is the round-up alone. A visit
  is recorded by `visitorFromRequest` at most once an hour per person (a request within
  the hour writes nothing): `last_visit_at` moves to `previous_visit_at`. `GET
  /portal/me/since-last-visit` is the round-up of changes since the previous visit and
  the AI paragraph, written at most once per UTC day per person (`portal_summary_cache`:
  the first request of the day claims the row, so concurrent tabs ask once). The
  paragraph is shown only while the changes and the visit it was written for match
  (`changes_hash`), and the answer waits at most 5 seconds for it; a slower paragraph
  is stored for the next load.
- **Favorites** (`favorites/`, Linear's `Favorite`): a person's sidebar bookmarks, each
  pointing at exactly one issue, project, custom view, cycle, document, issue label,
  project label, customer, dashboard, team or user, a fixed view (`predefinedViewType`,
  with `predefinedViewTeamId` for a team's), or a folder (`folderName`). Only the owner
  reads or changes a favorite; another person's is not found (and `favoriteDelete`
  succeeds without touching it, as Linear's delete does for a missing favorite). One per
  person and target (partial unique indexes): `favoriteCreate` for an existing one
  returns it, moved to the folder and `sortOrder` given (also when two creates race).
  Folders are not nested. `favoriteDelete` of a folder deletes its favorites (Linear);
  `/api/auth/instance/favorites/delete-folder` (the owner) moves all of them, including
  those whose item is hidden now, to the top level after the existing ones, then
  deletes the folder. Deleting a target deletes its favorites (foreign keys). New
  favorites go after their siblings (`max(sort_order) + 1000`; `sort_order` is a
  double). `favorites` and `Favorite.children` list only favorites whose target the
  viewer can see now and is not archived, retired or trashed, and documents only
  outside archived projects and issues (`favorites/access.ts`, one SQL condition;
  customers only while Customers is on). A request reads the viewer's favorites once
  with whether each is visible (`graphql/resolvers/favorite.ts`); target fields and
  `url` are null for a favorite that is not visible, and the targets load through the
  request loaders, so a list costs a fixed number of statements. `url` is the item's web
  page (null for folders, labels, project labels and users). Linear's create input has
  no initiative, so initiatives cannot be favorited.
- **Releases** (`releases/`, Linear's `ReleasePipeline`, `ReleaseStage`, `Release`,
  `ReleaseNote`): a pipeline belongs to one or more teams and is `continuous` (each sync
  is a release, completed at once, versioned by the first 7 characters of the commit
  SHA unless given; a version is kept for one full SHA) or `scheduled` (a release
  collects issues until completed). It is visible to whoever sees one of its teams;
  owners, admins and members who see a team edit it, guests only read; delete trashes.
  Each pipeline gets Planned, In progress, Completed and Canceled stages; a scheduled
  pipeline renames, recolours and orders them, adds `started` stages and freezes them (a
  sync aimed at a frozen release puts its issues in the next open release); a continuous
  pipeline's stages do not change; a stage with active releases cannot be archived. A
  release's stage sets its `startedAt`, `completedAt` (cleared when reopened) and
  `canceledAt`. An issue joins a release by hand (`issueToReleaseCreate`, its team must
  be one of the pipeline's) or by a sync; completing a scheduled release with
  `rolloverIssuesOnCompletion` moves its unfinished issues to the planned release with
  the earliest target date, or a new "Next". `currentProgress` follows the projects'
  progress rule. Links and documents are upserted by URL and title; release documents
  are served as `Document`. `includePathPatterns` is stored, not applied; pull-request
  references are ignored; no release webhooks are sent. **CI sync** (`sync.ts`):
  `releaseSync` (a team member's session or API key) and the `*ByAccessKey` operations
  take Linear's input; issue references match identifiers case-insensitively, and
  unknown, archived and other-team issues are skipped; a repeated sync adds nothing
  twice; a sync naming the version of an archived or trashed release is INVALID_INPUT
  until it is restored. A sync, a by-pipeline update and a completion of one pipeline
  run one at a time (an advisory lock), each reading the releases inside its
  transaction. What a sync added and skipped (`added`, `skipped` with `notFound`,
  `archived` or `otherTeam`, `redirectedFrom` for a frozen release) is in the
  response's `extensions.releaseSync`, since Linear's payload has no field for it (a
  resolver adds response extensions through `context.extensions`). Release and stage
  times are stamped on the database's clock. **Access keys** (`keys.ts`): `itpr_` keys
  stored as SHA-256, created and revoked by workspace owners and admins through
  `/api/auth/instance/access-keys*`, shown once; `graphql/context.ts` reads the
  credential and `graphql/mount.ts` resolves it to its pipeline (`keys.ts`) without
  better-auth, and it may run
  only the six `*ByAccessKey` operations (any other field is AUTHENTICATION_ERROR); a
  revoked key, or one of an archived or trashed pipeline, is refused. **Release notes**
  (`notes.ts`): Markdown for one or more releases of a pipeline (exactly one on a
  scheduled pipeline); "Fill from issues"
  (`/api/auth/instance/releases/note-draft?releaseId=`) lists the release's completed
  issues under Features, Bug fixes and Other by label name; with
  `autoGenerateReleaseNotesOnCompletion` a completed release with completed issues and
  no note gets that draft, listing public-team issues only (a note is read by anyone
  who sees the pipeline). An issue **ships** (`shipped.ts`) when it is in a release in a
  completed stage (not canceled) of a production pipeline and is completed itself, at
  the latest
  of the three times (Requester changes above; the portal issue page's `shipped`, the
  latest such release).
- **Dashboards** (`dashboards/`, `dashboard`): pages of Insights widgets, stored here
  since Linear's schema has no dashboard type, through `/api/auth/instance/dashboards*`.
  `widgets` is the web's configuration; the API checks only its shape (at most 24
  widgets, each with its own id, a kind `chart` / `number` / `table`, a width `half` /
  `full` and a config object; at most 100 KB). A dashboard is shared with the workspace
  (every owner, admin and member) or with teams (their members; a member names only teams
  they are in, an admin any existing team; deleted teams drop out of `teamIds`); owners
  and admins see every dashboard, and the owner always sees their own; guests and app
  users have none (403). The owner and owners / admins edit and delete it; anyone who
  sees one duplicates it (the caller owns the copy, shared with the original's teams the
  caller may name, else the workspace). An owner who leaves (deleted or suspended) leaves
  it with no owner. The workspace feedback report is the one dashboard with `system_key`
  `feedback`, owned by no one and always shared with the workspace (its sharing cannot
  change); `dashboards/feedback` creates it with the given widgets the first time (`ON
  CONFLICT DO NOTHING`, so two first opens give one) and again after it is deleted. A
  requester's `firstFeedbackAt` (requesters list) is their first active feedback on an
  issue the user can see; `/api/auth/instance/feedback/first-requests?since=` lists the
  people whose first one is at or after `since` (ids and dates only, one query), for the
  dashboards' "new people".
- **Uploads** (`uploads/`, Linear's `fileUpload`): `file_upload` reserves one file for
  one user (content type, size, object key) and returns a signed URL; the bytes are a
  plain HTTP `PUT /uploads/<token>` with the declared `Content-Type`, once, within 10
  minutes, and the token is the PUT's only credential (as in Linear). The URL is claimed
  before the bytes are stored and the upload counts as stored only after the write. A
  user's unused uploads may total at most 10 × `MAX_ATTACHMENT_MB`. A request is accepted when either use allows it; the use
  checks its own limits: `attachmentCreate` with the asset URL (`/uploads/<id>/raw`)
  turns it into an upload attachment after the attachment size, the allowed types and
  the team quota; `userUpdate({ avatarUrl })` takes only the user's own raster image
  within the avatar limit. Each use claims the upload, so one upload backs one
  attachment or one avatar; a replaced avatar is released (`avatars/release.ts`) by
  either avatar path. Uploads nothing used within a day are deleted
  (`/internal/uploads/cleanup`, called by the worker). An **import file** is an upload
  with `metaData.purpose` `import` (`metaData` an object or a JSON string): owners and
  admins only, a CSV type (`text/csv`, `application/vnd.ms-excel`, `text/plain`,
  `application/octet-stream`) whatever the workspace's attachment types, up to
  `MAX_ATTACHMENT_MB`; the raw route answers 404 for it, and only its uploader reads it
  back (`uploads/import-files.ts` `readImportFile`, with the SHA-256 of its bytes)
  until `deleteImportFile` removes it; it is never claimed as an attachment or an avatar
  (`ownStoredUpload`). CSV text is read by `imports/csv/parse.ts` (comma or semicolon,
  RFC 4180 quoting, at most 10,000 rows; a quote never closed is 400 "Unclosed quote
  starting on line <n>").
- **Notifications and subscriptions** (`notifications/`): `issue_subscription` holds
  Linear's issue subscribers. Creating an issue subscribes its creator and assignee;
  a new assignee, a comment's author and the members a comment mentions are
  subscribed too (`subscriptions.ts`); only members of the issue's team are
  subscribed, listed or notified. Comment and status-change notifications go to the
  subscribers, assignment and mention notifications to the assignee and the
  mentioned members, never to the actor. An archived notification (`archived_at`)
  is left out of the inbox and the unread count; GraphQL serves a notification as an
  `IssueNotification` (an `AgentSessionNotification` for an agent session) with
  Linear's type and category names, limited to the
  viewer's own on teams they are in. `subscriberIds` is accepted on `issueCreate` and
  `issueUpdate`, not on `issueBatchUpdate`. Email notification preferences are per
  Linear category for the whole workspace (`user_preference.notification_categories`,
  `notification-preferences/`; null means email for assignments and mentions only),
  served as `userSettings.notificationCategoryPreferences` (email channel only).
- **Agent sessions** (`agents/`, Linear's agent API): an `agent_session` belongs to
  one app user and one issue and has a comment thread (an empty root comment by the
  app user when it is not started from a comment). Delegating an issue to an app user
  granted `app:assignable`, or @-mentioning one granted `app:mentionable`, starts a
  `pending` session or prompts the app's open one; a person's reply in a session's
  thread is a `prompt` activity; app users' comments prompt nothing. Only the
  session's app user writes activities (`agentActivityCreate`); the status follows
  `agents/status.ts`. Stop is `POST /api/auth/instance/agent-session-stop`, a `stop`
  prompt. `created` and `prompted` send Linear's `AgentSessionEvent` webhook to the
  application's webhook whatever resource types it lists (`agents/webhook.ts`,
  registered in `app.ts`, best effort), only while the app can see the issue's team;
  a session whose app lost the team (a narrowed install, a team made private) ends
  as `stale` when the next event or reply finds it. One session per app in a thread
  and one open delegation session per app on an issue (unique indexes; a second
  trigger prompts the existing one). Activities apply under a row lock on the
  session; a repeated `agentActivityCreate` id from the same app returns the stored
  activity. `Comment.agentSession` is the session whose thread root the comment is,
  or that the reply started (a second app mentioned in a thread). A session's thread
  root can be deleted only by its app. The creator gets an
  `AgentSessionNotification` (inbox only) on an elicitation and on a response that
  ends the turn. Session side effects of a comment or a delegation are best effort.
  Uninstalling the application ends its open sessions as `stale` and marks its
  webhook's pending deliveries failed.
- **Workflow automations** (`workflows/`, Linear's `WorkflowDefinition`): a team's
  rules, managed through the instance plugin (`/api/auth/instance/workflows*`,
  `workflows/handlers.ts`) since Linear's schema has no operation for them. Only
  `type` automation, `triggerType` issue, `trigger` entityCreated or entityUpdated
  (with `activationMode` conditionsStartedMatching, which needs non-empty conditions).
  `conditions` is Linear's `IssueFilter` (checked with `issueFilterSql`; `isMe` is the
  rule's owner); `activities` is a list of actions (`setState`, `setAssignee`,
  `setPriority`, `addLabels`, `removeLabels`, `setProject`, `setCycle`, `setDelegate`,
  `addComment`), each checked on save to stay within the rule's team
  (`workflows/validate.ts`). Anyone who can see the team lists its rules; creating
  one, and changing a rule's edit access, needs a team manager; otherwise
  `editAccess` decides (`everyone`, `teamOwners`, `workspaceAdmins`, `owner`); admins
  and owners change any rule, guests and app users none (`workflows/access.ts`).
  A rule acts as its owner (`me` in its conditions, the creator of the agent sessions
  its delegations start), so the owner is always its last author: the creator, then
  whoever changes its conditions or actions; `ownerId` can only name the editor.
  The run engine (`workflows/engine.ts`, registered with the issues store through
  `setIssueRuleHook` from `app.ts`) runs after a person's `createIssue` /
  `updateIssue`: a created rule when the new issue matches, an updated rule when the
  issue did not match before the change and matches after it (one filter query over
  all the team's enabled rules before the write and one after; a batch update loads
  the rules once, `withRuleCache`; `issueUpdate` reads the "before" ahead of its
  subscriber change). Each matching rule, in `RULE_ORDER` (sortOrder, then creation,
  then id), applies its field and label changes as one `updateIssue` and then its
  comments; after a rule has run, a later rule runs only if the issue still matches
  it. The changes are made inside
  `runAsWorkflow` (`shared/workflow-context.ts`): those writes have no user actor,
  carry the rule in `issue_activity.workflow_definition_id` and
  `comment.workflow_definition_id` (GraphQL `botActor` `{ type: workflow }`), send
  their own webhook event with the workflow as `actor`, and run no rules. System
  writes (cycle rollover and cycle archive, the duplicate cancel, the restore move)
  run inside `withoutWorkflows`. An issue import's writes run inside `runAsImport`:
  no rule runs, no notification is written, no webhook or agent session event is sent
  and no agent session starts; history entries and subscribers are kept. `issueCreate`
  takes Linear's import dates (`createdAt`, and `completedAt` for a completed state)
  and `commentCreate` `createdAt`, from any caller. An action that no longer passes the issue checks is
  skipped and recorded in `stats.lastError`, the error of the most recent run (a
  clean run clears it); `stats.runs` and `last_executed_at` count each run. A
  delegation a rule makes credits the agent session to the rule's owner. Rules are
  best effort: a failure is logged and never fails the change. A rule's comment
  subscribes no one for the workflow; the members it mentions are subscribed as for
  any mention. A team has at most 50 rules, and a rule's conditions at most 8 KB and
  8 levels of nested objects (every enabled rule is checked on each issue write in
  its team). A notification a workflow's change causes stores the rule
  (`notification.workflow_definition_id`, GraphQL `botActor`). Deleting a rule keeps
  its row (`deleted_at`), so its history entries, comments and notifications still
  name it; a deleted rule is never listed, read, edited, counted against the limit or
  run.
- **Extra email addresses** (`accounts/`, `user_email`): a user adds addresses through
  `/api/auth/instance/account/emails*`; each counts once confirmed on the web's
  confirmation page (`/confirm-email?token=`), which the mailed link opens: opening it
  only reads the address (`confirm-info`), its button posts the token (`confirm`), so a
  mail scanner following the link confirms nothing (token stored hashed, 24 hours;
  logged as `[auth] email confirmation link for` when no mail provider sends it). A
  pending address gets a new link at most once a minute. At most 10 per user; an address that is an
  account's sign-in address or another user's confirmed one is refused, and confirming
  one removes other users' pending rows for it. They are used only by
  `memberEmails` (issue import matching), never for sign-in or in GraphQL.
- **Issue imports** (`imports/`, Linear's `IssueImport`): an `issue_import` row per
  job (status `inProgress` → `inProcess` → `complete` / `error`; never a token). The
  engine (`engine.ts`) creates the destination team's issues, labels (matched by name,
  missing ones created), comments ("**Name** on GitHub wrote:") and a link back to each
  source issue inside `runAsImport`. The link is written in the issue's own
  transaction with `metadata.imported: false`, set true once the comments are in; a
  rerun skips an issue whose link is complete and rebuilds a half-written one, so an
  interrupted import run again duplicates nothing. The issue's `created` history entry
  names the import (`issue_activity.issue_import_id`, `IssueHistory.issueImport`). On
  startup (`index.ts`) imports left running end as `error`.
  GitLab, Gitea and Forgejo imports go through the instance plugin
  (`/api/auth/instance/imports*`, `imports/handlers.ts`; owners and admins): the
  admin's token is used by a background fetch in the API process
  (`imports/sources/`: any host, http or https, no redirects followed, a response
  body at most 20 MB, rate limits waited out up to an hour per request with the wait
  shown as `serviceMetadata.waitingUntil`, lists read oldest first and each item kept
  once, comments read from the repository's comment list, the token never in an
  error, row or log) and dropped when the fetch ends; the fetched data waits in memory
  for the people matching (at most a day, then the import ends as expired; checked
  hourly from `index.ts`), then `processImport` runs. Starting the processing takes
  the fetched data and claims the import in one statement, and a partial unique index
  (`issue_import_team_in_process_uq`) allows one running import per team. A person
  matched to someone who is not (or no longer) an active member of the team is left
  unmatched. A team the import creates gets the matched members. `IssueHistory.issueImport`
  shows an import's error, people mapping and server address to owners and admins only.
  GitHub imports follow Linear's model: the workspace connects this instance's GitHub
  Import App (`integrationGithubImportConnect(code, installationId)`; the OAuth code
  confirms the person can access the installation, then their token is dropped) as the
  one `integration` row of service `githubImport` (the installation id, never a
  token), `issueImportCreateGithub` fetches the chosen repositories and
  `issueImportProcess` takes the people matching as `mapping.people`
  (`imports/github.ts`, `graphql/resolvers/issue-import.ts`). Installation tokens are
  minted from the app's key (`GITHUB_IMPORT_*`, `docs/github-import-setup.md`) and kept
  in memory until they expire. The fetch, people step and processing are shared by
  every source (`imports/flow.ts`); the Import page reads imports, the people step and
  the GitHub connection and repositories through `/api/auth/instance/imports*`, since
  Linear's schema has no query for them.
  **CSV imports** (`imports/csv/`): a CSV uploaded as an import file (Uploads) is read
  and parsed when the import is created (`csv/imports.ts`; a file that does not read is
  refused then) and its rows wait for the Statuses and People steps like a fetched
  source. A **Jira** export (`csv/jira.ts`) goes through Linear's `issueImportCheckCSV`
  (`service: "jira"`; INVALID_INPUT "The file is not a Jira CSV export (no Summary
  column)") and `issueImportCreateCSVJira` (the Jira credentials are accepted and not
  used; `jiraHostname`, when given, links each issue to `https://<host>/browse/<key>`),
  or the Import page's `/api/auth/instance/imports/csv/create` with `source: jira`; a
  **generic** CSV only through the Import page, with `source: generic` and the column
  mapping confirmed on its Columns step (`/api/auth/instance/imports/csv/preview` gives
  the headers, sample rows, guessed mapping and whether the file is a Jira export). The
  import's `serviceMetadata.statuses` lists the file's distinct status values and
  `statusGuesses` the guessed state of each (`csv/guess.ts`: a state id, or a default
  state name for a team the import creates); `issueImportProcess` (or
  `issueImportUpdate`, which saves the mapping without starting, only while the import
  waits for it, else CONFLICT) and the Import page's process endpoint take `statuses`
  (`{ "<value>": "<state id or name>" }`) beside `people`; a value left out takes the
  guess, and a target that is not one of the destination's active states is 400 naming
  the status value, checked before the waiting rows are taken (`checkStatusTargets`).
  One person has at most 3 CSV imports waiting for their mapping (409 "Finish or cancel
  a waiting import first"), since each holds its rows in memory. The date format guess
  reads every row. Jira wiki links keep only http, https and mailto targets. A CSV
  row's state type sets its completed or canceled date; its priority, due date and
  estimate (kept only on the team's scale, else counted) are imported. A CSV row has no
  source URL: its identity in the team (`jira:<Issue key>`, `csv:<ID column>`, else
  `csv:<file sha256>:<row>`, so rows keyed by number are skipped only on a re-run of
  the identical file) is recorded in `issue_import_source` in the issue's transaction
  with the same `imported` flag as a link. Rows without a title and values that did not
  read are reported in the summary (`skipped` as "Row <n>", `counts`). The file is marked
  used once the import exists (a refused create leaves it to the daily sweep) and
  deleted when the import ends (completed, error, expired or interrupted;
  `imports/files.ts`). A Jira link's key is URL-encoded, and the link is marked
  imported once the issue's comments are in.
- **Estimates** (`teams/estimates.ts`, Linear's `Team.issueEstimation*`): a team's
  scale is `issueEstimationType` (`notUsed`, the default for every team, `exponential`
  1, 2, 4, 8, 16, `fibonacci` 1, 2, 3, 5, 8, `linear` 1–5, `tShirt` stored as 1, 2, 3,
  5, 8), `issueEstimationExtended` (adds 32, 64 / 13, 21 / 6, 7 / 13, 21) and
  `issueEstimationAllowZero` (adds 0), set by team managers through `teamUpdate` or on
  `teamCreate` (the same checks, before the team is created);
  `defaultIssueEstimate` (at least 0, default 1) is what an unestimated issue of the team
  counts in weighted progress (cycles, projects and their histories, releases); a team
  that does not use estimates has its stored estimates ignored there and counts each
  issue as 1 (`usedEstimateSql` / `usedDefaultEstimateSql`). Changing the settings
  changes live figures and later snapshots; stored history days keep the values of
  their day;
  `inheritIssueEstimation` reads false and true is INVALID_INPUT (no sub-teams).
  `createIssue` and every `updateIssue` path (`checkPatch`, so a batch is refused
  before its first write) refuse an estimate off the team's scale, or any estimate
  while the team does not use estimates; `null` clears. Changing the scale keeps stored
  estimates. Issues do not move between teams, and workflows and imports set no
  estimate, so these are the only write paths.
- **Audit log** (`audit/`, Linear's `AuditEntry`): one `audit_entry` row per
  security-relevant action (`audit/types.ts` lists the types and their descriptions).
  Owners and admins read it through `auditEntries` (Linear's `AuditEntryFilter`; the
  entity filters read `entityType` / `entityId` / `entityIdentifier` from the metadata)
  and `auditEntryTypes`; everyone else, and an OAuth token without `admin`, gets
  FORBIDDEN. Nothing edits or deletes an entry except the retention clean-up and the
  fold of failed sign-ins below. `recordAudit(type, metadata, { tx?, actorId? })` writes
  inside the action's transaction when it has one (the action and its entry succeed or
  fail together); without one a failed write is logged (`[audit] entry not written`)
  and the action goes ahead, and the next entry the process writes carries
  `metadata.missedEntries` (the misses it reports; misses counted meanwhile stay for the
  next one). `recordLoginFailed(address, reason)` folds attempts for one address and IP
  within 10 minutes into one entry (`metadata.attempts`; `reason` is the latest,
  `reasons` every one given; the address is kept to 320 characters); past 20 addresses
  from one IP in the window, further addresses add to one entry for the IP (`scope:
  'ip'`, `addresses`, `attempts`), so neither repeating nor changing the address floods
  the log. It marks the request (`refusalRecorded`) so better-auth's after hook adds no
  second entry. Instance-plugin actions pass their user as the actor; otherwise the
  actor is the request's user. The request details (`audit/context.ts`: IP and country,
  user agent, how the request authenticated (`none` on a refused sign-in), the route or
  GraphQL operation, at most 200
  characters and read only when an entry is written, the OAuth application or release
  pipeline) are set around GraphQL, every `/api/auth/*` request, MCP (whose tools' in-
  process GraphQL requests keep MCP's client) and the worker's audit and project purge
  routes (`asWorker`). The IP follows the portal's rule (`shared/client-ip.ts`: proxy
  headers only when `TRUST_PROXY=true`, anything not an IP address read as null), and
  the country is `AUDIT_COUNTRY_HEADER` (`CF-IPCountry` by default) only then.
  `/api/auth/*` requests reach better-auth with that address in `x-itsaplan-client-ip`
  (a client's own value dropped), which better-auth's rate limits and sessions read.
  Metadata holds ids, names and what changed, never secrets or issue content (a
  webhook's URL only as its origin).
  Retention (`audit/retention.ts`, `organization.audit_retention`): 30 days by default,
  or 90 days, 1, 2 or 3 years, or forever; owners and admins read it and owners change
  it through `/api/auth/instance/audit-settings*` (the change is recorded); the worker
  calls `/internal/audit/cleanup` on its cleanup interval, which deletes older entries
  in batches of 10,000, each its own statement.
  Data events are written in the action's transaction: an import started
  (`createImport`), finished or failed (`setImportStatus`, once: setting a finished
  status again records nothing, and the restart sweep), a
  project trashed (`projectDeleted`) or purged by the worker (`projectPurged`, no
  actor), an issue, dashboard or customer deleted, customers or requesters merged
  (names only, never a requester's email), portal boards created, changed (the changed
  settings; the allowed addresses only as a count) and deleted, requesters blocked or
  unblocked, and a form's settings saved or the form deleted (`formSettingsChanged`).
  Exports are `dataExported`: `audit/export.ts` builds the filtered audit log as CSV
  (`POST /api/auth/instance/audit/export { type?, actorId?, ip?, from?, to? }` behind
  the Origin check, owners and admins; RFC 4180 with CRLF, every data cell quoted, a
  cell starting with `= + - @` or a tab prefixed with `'`; newest first, at most 100,000
  entries, streamed in batches of 500 by (created_at, id)) and records it with its
  filters and row count first; `POST /api/auth/instance/audit/export-recorded { kind:
  'dashboard' | 'widget', id, name, rows }` (members and up) records a CSV the web built
  itself.
- **Auto-archive** (Linear's `Team.autoArchivePeriod`): `team.auto_archive_period` in
  months (0, 1, 3, 6, 9 or 12; 0 = off; new teams 6). The worker archives completed and
  canceled issues closed longer than that (`apps/worker/src/store.ts`). Auto-close is
  not offered: `autoClosePeriod` reads 0 and a non-zero value is INVALID_INPUT.

## Auth and access

- **Credentials:** GraphQL resolves a session cookie, an API key or an OAuth access
  token (`graphql/context.ts`; see GraphQL below). The file routes need no session: the
  raw GETs are public and the upload PUT carries its own token.
- **Linear's model** (`shared/access.ts`, the one place access is decided):
  workspace roles on the user (`user.workspace_role`: `owner`, `admin`, `member`,
  `guest`); teams are `public` or `private`; `team_member.owner` marks a team
  owner. Owners, admins and members see and work in every public team and their
  private teams; guests only in their teams (`visibleTeamIds`). Team management
  (settings, states, team labels, members, visibility, deletion) needs a team
  owner or a workspace admin, or any member when the team has no owner.
  Workspace actions follow the role table in
  `docs/superpowers/specs/2026-11-22-linear-roles-design.md` (`assertWorkspaceRole`).
  A team the user cannot see is 404; a visible team without the right is 403.
- **App users** (an OAuth application installed with `actor=app`, `@repo/auth`
  `oauth-install.ts`): `workspace_role` = `app`, which `workspaceRole` reads as a
  guest, so an app user is never an admin and never manages a team. It sees its
  `team_member` teams, plus every public team when its install includes them
  (`seesPublicTeams`); it reaches initiatives through those teams. It is left out of
  member lists (workspace users, `Team.memberships`,
  `teamMemberships`), gets its teams only from its install (no membership change is
  made by it or to it: `assertNotAppUser` in `members/store.ts`), offered in `Team.members` only when its install granted
  `app:assignable` or `app:mentionable` (`User.isAssignable` / `isMentionable`), and
  never set as an assignee. GraphQL `users` lists it with `app: true`.
- Resolvers check access with the `shared/access.ts` primitives (`assertPermission`
  and the team, project and initiative checks) before calling a store.
- **Joining the workspace and teams:** people join the workspace through workspace
  invites (`invites/`, `workspace_invite`): an invite carries a role (admin, member,
  guest) and teams, applied by the better-auth user-create hook when the address
  signs up, which also deletes the invite; one pending invite per address, and an
  address that already has an account cannot be invited. Nobody invites above their
  own role. Anyone who can see a team may join it (`teamMembershipCreate` for oneself);
  any team member may add people to a public team, a team manager to a private
  one or as a team owner (`members/`).
- **Workspace settings** (`organization/`, Linear's `Organization`): one
  `organization` row (name, URL key, logo, allowed sign-in services, allowed upload
  types, and the minimum role for creating teams, managing workspace labels and project
  labels, and inviting: `owner`, `admin` or `member`, checked by `assertAllowedTo`).
  Owners and admins change it (`organizationUpdate`, whose
  `securitySettings` carry the minimum roles); everyone signed in reads it. Instance
  secrets and server limits are environment variables: the mail provider and Google
  credentials (`@repo/auth`), `APPROVED_EMAIL_DOMAINS`, and `MAX_ATTACHMENT_MB`,
  `MAX_AVATAR_MB`, `TEAM_QUOTA_MB` (`settings/storage.ts`).
- **Workspace administration** (`workspace/`): admins change the roles of members
  and guests and suspend them; owners act on anyone and alone make or remove
  owners; the workspace keeps at least one active owner. A suspended user
  (`user.suspended_at`) has no sessions, cannot sign in (better-auth session
  create hook), is refused on API keys (`getActiveSession`, used by GraphQL and
  MCP) and receives no notifications; memberships and history stay. There is no
  hard user delete.
- **Projects span teams** (`project_team`), so access to a project resolves through
  every team of the project (`projects/access.ts`): a project none of whose teams the
  user can see → 404. Issues may only join a project
  that includes their team; a team with issues in a project cannot be removed from it.
  Project statuses are six seeded rows (`project_status`, ids in
  `packages/db/src/project-statuses.ts`); `resetDb` keeps them.
- **Project relations** (`projects/relations.ts`, Linear's `ProjectRelation`): a
  dependency (`type` always `dependency`) where the project's anchor blocks the related
  project's anchor; an anchor is `start` (start date), `end` (target date) or
  `milestone` (one of that project's milestones, required for it and refused for the
  others). No relation to the same project, one per pair of anchors (CONFLICT), and no
  cycle between projects (checked under an advisory lock; INVALID_INPUT). A relation is
  visible when the viewer sees both projects and neither is archived or trashed
  (`Project.relations` / `inverseRelations`, `projectRelations`); writing one needs
  both projects visible and a role above guest. Deleting either project or an anchoring
  milestone deletes it. No webhooks.
- **Project trash** (`projects/store.ts`): `projectDelete` archives the project and
  sets `trashed`, as Linear does; `projectUnarchive` restores an archived or trashed
  project with its members, milestones, updates and initiative links. An issue cannot
  be put in an archived or trashed project, but one already in it keeps it. The
  worker calls `/internal/projects/purge`, which deletes projects trashed more than
  `PROJECT_TRASH_DAYS` (30) days ago; a project only archived through `projectArchive`
  is never purged. A purged project's issues lose the project and its milestone, each
  with a system history entry and an Issue update event.
- **Project progress** (`projects/progress.ts`): `Project.progress` and `scope` follow
  the cycles' rule (`shared/progress.ts`: completed 1, started 0.25, canceled left out,
  weighted by estimate when any issue has one, an unestimated issue counting its team's
  `defaultIssueEstimate`, and each issue of a team not using estimates counting 1). The five history arrays hold one value
  per UTC day from `history_start`: built from `issue_activity` (project and status
  changes by id, worked back from each issue's current values; current estimates for
  past days) the first time they are read or snapshotted, and again only when the
  start date moves to a day that has begun; then the worker's hourly
  `/internal/projects/snapshot` fills the missing days of each open project and
  rewrites today's day, so a finished day holds its last snapshot. The build works in
  chunks of projects, stores each chunk before the next and yields the event loop
  between them, and splits id lists into batches of 1,000. An open project's today is
  always live; a project that is completed, canceled, archived or trashed has its
  closing day stored then (`closeProjectHistory`) and gets no new days (one never
  built is built up to the day it was archived or last changed). Writes check
  `history_start` so a rebuild and a snapshot never mix. The histories resolve through
  the `projectHistory` request loader, and Project webhook data carries them (computed
  without storing).

## Security

- **`GET /attachments/:publicId/raw`, `/avatars/:id/raw` and `/uploads/:id/raw` are
  public and unauthenticated** (used in `<img>`/`<video>`). They answer through
  `shared/raw-object.ts`; preserve its defenses: `X-Content-Type-Options: nosniff`,
  forced download outside a strict media allowlist, locked-down CSP.

## Tests

`bun test` driving the app in memory (`app.handle`, no port) against a real test
Postgres and real better-auth sessions — nothing is mocked. Import `app` from
`src/app.ts`, never `src/index.ts` (it binds the port).

**Setup.** Point tests at a dedicated `*_test` database, never dev/prod:

```bash
cp .env.test.example .env.test        # repo root; DATABASE_URL must name a *_test database
bun run db:migrate:test               # migrate it (repo root)
bun run test                          # from apps/api, or at root via turbo
```

The `test` script loads `--env-file=../../.env.test`. The attachment and upload tests
also need RustFS + `S3_*` in `.env.test` (`docker compose -f docker-compose.dev.yml up -d`
creates the bucket); the Docker test gate starts its own throwaway RustFS.

**Layout.** Tests colocated under `__tests__/`, `integration/` (the running app + test
DB, one file per feature) or `unit/` (pure functions, no session/HTTP/DB — import
directly). Helpers in `src/__tests__/helpers/`: `signUpTestUser()` →
`{ cookie, userId, email }` (the first in a test is the workspace owner, later ones
members), `resetDb()`; `graphql.ts` (`gqlData(as, query, vars)`, `signUpAs(role)` and
setup helpers: `createTeam`, `addMember`, `createIssue`, `createComment`,
`createProject`, …, which take a team key or id), `linear.ts` (a `LinearClient` on a
local port, `createApiKey`), `mcp.ts`, `oauth.ts`, `statements.ts` (`countStatements`, for
tests that bound a request's SQL statements).

**Rules.**

- `beforeEach(resetDb)`. Build every precondition through GraphQL (the helpers), not
  raw inserts.
- Assert through the API (GraphQL data and error codes, side effects via a follow-up
  query), never by reading rows.
- One test per rule: happy path, one valid + one invalid per field rule, boundaries
  (empty, max/max+1, last owner), each failure code (INVALID_INPUT, FORBIDDEN,
  ENTITY_NOT_FOUND, CONFLICT), and the feature's own access (who succeeds; a user who
  cannot see the team gets ENTITY_NOT_FOUND).
- Confirm each case goes red when the behavior is broken.
- Don't hardcode ids or the "-42" sequence — read them from the create response.

## Webhooks (Linear-compatible)

Outgoing webhooks use Linear's format and subscription model, so a Linear webhook
receiver works against the instance.

- **Subscriptions** (`webhooks/store.ts`): a webhook covers one team, all teams
  (`all_public_teams`, including teams created later), or an OAuth application's
  reach (`oauth_client_id`, one per application, managed with the application in
  `oauth/apps.ts` and never listed or addressable as a workspace webhook). An
  application installed with `actor=app` receives the events of its app user's teams;
  one people have only authorized as themselves receives public teams' events; an
  archived or uninstalled one nothing. A webhook lists resource types:
  `Issue`, `Comment`, `IssueLabel`, `Project`, `ProjectUpdate`, `Reaction`, `Cycle`,
  `Initiative`, `InitiativeUpdate`, `Document`, `Attachment`, `CustomerNeed`, `Customer`. Initiative events go to the lead team's
  webhooks, or only to all-teams webhooks for a workspace initiative. Webhooks are
  managed by workspace admins and owners: a team webhook by one who can see the team,
  an all-teams webhook by any (`webhooks/access.ts`, checked on every operation). An
  all-teams webhook receives workspace-level events and events touching a public
  team; a private team's events reach only its own team webhooks.
- **Events:** the stores call `emitEvent` (`webhooks/event.ts`) after a change,
  with the entity's data from `webhooks/data.ts` before and after it. `data` is the
  GraphQL mapper's output plus Linear's relation ids; `updatedFrom` holds the
  previous values of changed fields. A label group is sent as an `IssueLabel` with
  `isGroup: true`. A project event reaches the webhooks of every team it includes;
  an update also reaches the teams it had before. One user edit sends one event
  (`updateIssue` takes `labelIds`; a project team change passes its before-data to
  `updateProject`). Issue paths check `isWatched` first, so no data is built for a
  team without webhooks. A new write path for these entities must call `emitEvent`
  too.
- **Delivery** is the worker's (`apps/worker`): it adds `webhookTimestamp`, signs
  the body and retries on Linear's schedule. An application's webhook is skipped
  once the application is archived or neither installed nor authorized by anyone.

## GraphQL (Linear-compatible)

`/graphql` serves Linear's published schema so `@linear/sdk` and Linear tools work
against the instance. Code is in `src/graphql/`; it is mounted in `app.ts` with
`mountGraphql(app)`.

- **Schema:** `schema.graphql` is vendored unmodified (source and update steps in
  `SCHEMA_SOURCE.md`). Never edit it. The `@linear/sdk` dev dependency is pinned to
  the same release; `__tests__/unit/sdk-documents.test.ts` validates every SDK
  operation against it.
- **Auth:** `Authorization: <key>` or `Authorization: Bearer <key>` is resolved as
  `x-api-key` through better-auth (`context.ts`); a session cookie also works. An
  OAuth access token (`Bearer itpo_…`) is checked with `resolveOAuthAccessToken` and
  acts within Linear's scopes: `scopes.ts` refuses a query without `read` and a
  mutation without `write` (except `issueCreate` / `attachmentCreate` with
  `issues:create` and `commentCreate` with `comments:create`), and
  `shared/access.ts` `workspaceRole` reads an owner or admin as a member when the
  token lacks `admin`, so every admin check refuses it. The request's credentials
  are kept in `shared/request-auth.ts` for the execution. No
  valid credentials → HTTP 401 with `extensions.code: AUTHENTICATION_ERROR`, except a
  query whose root fields are only `organizationInviteDetails` (`anonymous.ts`), so the
  invite page works before the invitee has an account. Its `id` is the invite's secret
  token, not the invite's id.
- **Unimplemented parts:** a root Query/Mutation field without a resolver answers
  `NOT_IMPLEMENTED`. Any other field without a resolver reads its parent's property
  or resolves to a neutral value by type (`schema.ts`). Add a resolver; do not
  edit the schema.
- **Writes:** mutations call the store functions after the `assertPermission`
  checks (`resolvers/mutations.ts`), so activity, webhooks and notifications are
  written in one place. Store `HttpError`s map to `INVALID_INPUT` / `FORBIDDEN` /
  `ENTITY_NOT_FOUND` / `CONFLICT` (`errors.ts`).
- **Access:** the rules in Auth and access: a team and everything in it is visible
  through `visibleTeamIds`; a project through any of its teams; every workspace user
  to owners, admins and members, and to a guest only the people sharing a team. A comment or reaction follows the item it
  is on; workspace labels are visible to anyone in a team. An initiative follows its
  lead team (see Initiatives); a link or relation is listed only when both ends are
  visible.
- **Coverage:** issues, workflow states, teams (with `teamUpdate`), users, projects
  (statuses, milestones, updates, project labels), comments, reactions, issue
  labels, issue relations, documents, attachments, notifications and issue subscriptions,
  workspace roles (`userChangeRole`, `userSuspend` / `userUnsuspend`, the role flags on
  `User`), team visibility, team memberships, organization invites, `teamCreate` / `teamDelete`, issue and
  project history (`Issue.history`, `Issue.stateHistory`, `Project.history`, read from
  `issue_activity`, whose `from_id` / `to_id` carry the referenced rows' ids), custom
  views and view preferences, project relations, favorites, issue templates, `fileUpload` and `userUpdate` (name, time zone, avatar; a
  user without a name reads as its email's local part in `name` and `displayName`),
  `userSettings` / `userSettingsUpdate` (email notification categories),
  `organizationInviteDetails`, project progress and scope, cycles, initiatives (project links, sub-initiatives,
  updates), webhooks
  feedback (`customerNeed*`, `Issue.needs`, `ExternalUser` through attachments) and
  customers (`customer*`, `customerStatus*`, `customerTier*`; not `customerUnsync`) and
  releases (`releasePipeline*`, `releaseStage*`, `release*`, `releaseNote*`,
  `issueToRelease*`, `Issue.releases`) have resolvers; the rest of the schema is
  neutral or NOT_IMPLEMENTED.
- **Filters and pagination:** `filter.ts` and `issue-filter.ts` list the supported
  filter fields; any other key is `INVALID_INPUT`. Connections (`connection.ts`)
  page newest first, 50 by default, 250 at most. A `sort` argument (`sort.ts`) is a
  list of one-key objects applied in order, each with `order` (Ascending by default) and
  `nulls` (`last` by default), then the list's tie-break and the id; a sorted list pages
  forward only (`last` / `before` is INVALID_INPUT) with a cursor of the row's sort
  values (each checked against its key's type; a cursor that does not fit the sort is
  INVALID_INPUT), and `sort` wins over `orderBy`. Issue sorts (`issue-sort.ts`) take every
  `IssueSortInput` key except `slaStatus`, read as Linear's schema describes them
  (cycle by start date with `currentCycleFirst`, project by name, milestone by target
  date, release by the most recent completed release, customer by name, customer
  revenue by the largest customer's revenue, label group by the issue's label in that
  group, `rootIssue` by its nested sort on the issue's top ancestor with the nested
  key's `order` / `nulls` or else its own, link count by the issue's attachments that are
  not feedback sources); text keys order lowercased by code point (`lower(…) COLLATE
  "C"`, the web app's comparison too), whatever the database's collation; an issue with
  several labels or customers sorts by its lowest ascending and its highest descending;
  a related item the viewer cannot see sorts as empty: a person outside the viewer's
  reach (`visibleUsers`), a release of a pipeline the viewer cannot see, and customers
  for a viewer who cannot read them or while Customers is off; ties go to the manual order, then newest first. Users,
  projects, initiatives, documents, custom views, releases and release pipelines take
  their `sort` keys too (`list-sorts.ts`, `resolvers/team.ts`): health by the latest
  update (on track, at risk, off track, then none), lead / owner / creator by shown name
  (empty when the viewer cannot see the person),
  project status by its position, a release's stage by type (planned, started,
  completed, canceled) then position, priority with no priority after Low unless
  `noPriorityFirst`; ties go newest first. Text keys of every list order without regard
  to case (`parseCaselessSort`).
- **MCP** (`mcp/`): `/mcp` (every tool) and `/mcp/readonly` (read tools only) take
  an API key or an OAuth access token as `Authorization: Bearer` (no cookie). A 401
  carries `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`
  (or `.../mcp/readonly`; served by `oauth/routes.ts`, RFC 9728), where an MCP client
  starts signing in. The tools are Linear's MCP tool set (`mcp/tools/`); each runs
  GraphQL in process as the caller (`mcp/graphql.ts`: a `/graphql` request carrying
  the caller's own credential), so access and scopes are GraphQL's. Tools take names,
  keys or ids (`mcp/resolve.ts`); a reference that matches several records is refused
  with the candidates. The server instructions (`mcp/instructions.ts`) carry the
  workflow rules for working on an issue.
- **Tests:** `src/__tests__/helpers/linear.ts` serves the app on a local port and
  returns a `LinearClient`, so tests drive the endpoint with the real SDK.

## Rules

- Auth logic is in `@repo/auth`, DB access via `@repo/db` — do not re-instantiate
  either. The web app never imports these packages; it uses this API over HTTP.
- CORS `origin` is the `trustedOrigins` list exported by `@repo/auth` — do not re-parse
  `APP_URL` here.
- better-auth's own reference (`/api/auth/reference`) stays reachable without a
  session.
- Dev: `bun run dev`. Prod: the Dockerfile migrates, then starts the server.

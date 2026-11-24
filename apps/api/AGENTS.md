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
  `project`, `cycle`, `myIssues`; one per user and view type), read through
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
  the issue; the number only). A quote is at most 10,000 characters. `customerCount` / `customerImportantCount` (filter and `sort`) count the
  distinct requesters of an issue's active feedback (with important feedback);
  feedback without a requester is not a person. Moving feedback to another issue moves
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
- **Portal boards** (`portal/`, `portal_board`): a board shows the active issues of
  one public team or one project (its public-team issues only), narrowed to any of its
  labels when it has some, whose state has a public status (`portal/status.ts`:
  planned, in progress, done; triage and canceled issues and issues completed more
  than 30 days ago are not shown). A board cannot target a private team. Owners and admins manage
  boards through `/api/auth/instance/portal/*` (`portal/admin.ts`); a board with
  suggestions gets the suggestion team's "Portal" label unless another is chosen.
- **Portal visitors** (`portal/session.ts`, `portal/routes.ts`): people outside the
  workspace use the boards through the API's own `/portal/*` routes, not better-auth.
  A visitor asks for a link on a board (`POST /portal/auth/link`, always `{ ok: true }`;
  mailed only when the address may read the board and its requester is not blocked;
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
  the requester's current email; changing a requester's email or merging requesters
  ends the sessions of the people involved. Blocking a requester
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
  details; it runs as any issue creation. Similar issues match any title word of two
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
  (`/internal/uploads/cleanup`, called by the worker).
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
  weighted by estimate when any issue has one). The five history arrays hold one value
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
  `Initiative`, `InitiativeUpdate`, `Document`, `Attachment`, `CustomerNeed`. Initiative events go to the lead team's
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
  views and view preferences, `fileUpload` and `userUpdate` (name, time zone, avatar; a
  user without a name reads as its email's local part in `name` and `displayName`),
  `userSettings` / `userSettingsUpdate` (email notification categories),
  `organizationInviteDetails`, project progress and scope, cycles, initiatives (project links, sub-initiatives,
  updates), webhooks
  and feedback (`customerNeed*`, `Issue.needs`, `ExternalUser` through attachments)
  have resolvers; `sort` arguments are INVALID_INPUT, except one `customerCount` or
  `customerImportantCount` sort on issue lists (forward paging only); the rest of the
  schema is neutral or NOT_IMPLEMENTED.
- **Filters and pagination:** `filter.ts` and `issue-filter.ts` list the supported
  filter fields; any other key is `INVALID_INPUT`. Connections (`connection.ts`)
  page newest first, 50 by default, 250 at most.
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

# GraphQL gaps for the web app

Project 4 of the Linear-only app (after removing non-Linear features, Linear's roles,
and Organization settings). Project 5 moves the web app to GraphQL page by page;
this project makes sure every page has a GraphQL source and removes the web
features Linear does not have.

## Intent

An inventory of the web's 97 REST calls found 65 already served by GraphQL, 14 in
Linear's schema but not implemented, and 20 with no Linear counterpart. This project
implements the 14, maps the 20 onto Linear's model or removes them (approved), and
removes the dropped features from the API, the database and the web, so the web
keeps working on REST until project 5 switches each page.

## Goals

### Implement (Linear's schema)

- **Custom views:** `customViews`, `customView`, `customViewCreate`, `customViewUpdate`,
  `customViewDelete` over the saved views (`team_view`). Linear's `filterData`
  (`IssueFilter`) is the stored filter and the only source of truth; the web's
  filter set is converted to and from it (project 5), and the stored web filters are
  converted in the migration. The view's layout and display settings use Linear's
  `viewPreferencesCreate` / `viewPreferencesUpdate` / `CustomView.viewPreferencesValues`.
  `team_view` gains `creator_user_id` (existing views: the team's oldest owner, else
  its oldest member) for `CustomView.creator` / `owner`. Team views only (builder's
  call).
- **Issue history:** `Issue.history` (`IssueHistory`) from `issue_activity`, with
  Linear's typed fields (`fromState`/`toState`, `fromAssignee`/`toAssignee`,
  priority, title, labels added/removed, project, cycle, parent, relation changes,
  archived, …). `issue_activity` gains `from_id` / `to_id` (the referenced row's id)
  and every activity writer records them from now on; rows written before keep their
  names only and give null typed fields (nothing has been released, so there is no
  backfill) (builder's call).
- **State history:** `Issue.stateHistory` (`IssueStateSpan`: state, `startedAt`,
  `endedAt`) from the status changes that carry ids, starting with a span from the
  issue's creation in its first recorded state (or its current state when no change
  is recorded).
- **Project history:** `Project.history` (`ProjectHistory`) from the project's
  activity.
- **File upload:** `fileUpload(contentType, filename, size)` returns Linear's
  `UploadFile` (`uploadUrl`, `assetUrl`, headers); the upload is a plain HTTP `PUT`
  to `uploadUrl` (a short-lived, single-use signed URL bound to the uploader, the
  content type and the size). `fileUpload` accepts a file allowed as either kind (the
  organization's types up to `MAX_ATTACHMENT_MB`, or a raster avatar image up to
  `MAX_AVATAR_MB`); the purpose's own limits are checked when the asset is used:
  `attachmentCreate` with the `assetUrl` checks the attachment limits, the
  organization's types and the team quota; `userUpdate({ avatarUrl })` accepts only a
  raster image (no SVG) within the avatar limit, or null to clear. An upload no
  attachment or avatar references within 24 hours is deleted by the worker (builder's
  call).
- **`teamDelete(id)`**, team managers only (project 2 rules): deletes the team as the
  REST route does today, with its objects removed from the store (Linear's 30-day
  archive is not offered; `teamUnarchive` stays NOT_IMPLEMENTED) (builder's call).
- **`workflowStateUpdate.position`** (reorder states).
- **`organizationInviteDetails(id)`** answers without a login (the only operation
  that does; everything else still needs credentials). Its `id` argument is the
  invite's secret token (the value in the invite link), not the invite's id, so
  seeing an invite in a list does not allow a public lookup (builder's call).
- **`issueBatchUpdate` with `addedLabelIds` / `removedLabelIds`**, and
  `issueAddLabel` / `issueRemoveLabel`.
- **`Team.autoArchivePeriod`** (months: 1, 3, 6, 9 or 12; 0 = off) read and written
  through `teamUpdate`, replacing the two stored day thresholds. Auto-archive archives
  completed and canceled issues closed longer than the period. The migration takes
  the larger of the two day thresholds and rounds it up to the next allowed month
  value (off stays 0). `autoClosePeriod` reads 0 and `teamUpdate` refuses a non-zero
  value (auto-close is not offered) (builder's call).
- **Notification preferences:** `userSettings` and `userSettingsUpdate` with Linear's
  `notificationCategoryPreferences` (per category: email on or off) for the workspace,
  replacing per-team email toggles. Categories: assigned → `assignments`, mentioned →
  `mentions`, commented → `commentsAndReplies`, status changed → `statusChanges`.
  Migration: a category is on when it was on in any team. Users with no rows, and new
  users, get email for `assignments` and `mentions` only (builder's call).
  `userUpdate({ timezone })` sets the time zone.
- **IssueFilter `archivedAt`** (so the archive page lists only archived issues).
- **Project progress:** `Project.progress`, `scope`, `completedScopeHistory` /
  `scopeHistory` as available, and health from the latest project update. The
  server-derived `computedHealth` is removed (Linear has none); a project without
  updates has no health (builder's call).
- **`organization.authSettings`** includes `approvedDomains` (read-only, from the
  environment).

### Remove (no Linear counterpart; approved)

- Member description (`team_member.description`), the full webhook delivery log
  route (`Webhook.failures` stays), view order, issue `start_date` and the board's
  "time in status" (`statusSince`), changing a state's type, the per-team MCP switch
  (`team.mcp_enabled`; MCP access is by API key), the per-team projects switch.
- Revision-marker routes (board, issue, project, notifications): the web refetches
  on an interval with `updatedAt` filters instead.
- Server-stored UI preferences other than the time zone (theme, issue open mode,
  start page, stats section, last team, hotkeys): kept in the browser. Linear's
  `UserSettings.theme` is a per-device preset, not one light/dark/system value, and
  `UserSettingsUpdateInput` has no theme field (builder's call).

### Kept as plain HTTP (needed before sign-in or by uploads)

`/auth-config`, the running version, the upload `PUT`, the public raw downloads.

## Non-goals

- Switching web pages to GraphQL (project 5).
- Bulk archive and delete as GraphQL operations: the web loops over `issueArchive` /
  `issueDelete` (Linear has none).
- Project status counts, timeline slices, offset paging: worked out by the web from
  GraphQL queries in project 5.

## Anti-goals

- A gap left for project 5: every web page must be expressible with GraphQL (plus
  the plain-HTTP list above) at the end of this project.
- A removed feature still half-present (a column, a route, a web control).
- `organizationInviteDetails` leaking more than Linear's (no team names of private
  teams, no inviter email beyond Linear's fields).
- An upload URL usable by someone else, more than once, or after it expires.

## Approaches

1. **Gaps and removals together (chosen).** Project 5 only changes transport.
2. **Gaps now, removals per page in project 5.** Rejected: mixes concerns in every
   web stage.
3. **Gaps lazily during project 5.** Rejected: web stages stall on API work.

## Left to the builder

Task order, the signed upload URL scheme, the mapping of each activity action to
`IssueHistory` fields, migrations (incremental), and the web edits that keep the
REST pages working after the removals.

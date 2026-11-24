# Issue import (GitHub, GitLab, Gitea, Forgejo) and the sidebar's Try section

## Intent

Teams moving to this instance bring their existing issues from GitHub, GitLab, Gitea or
Forgejo once, the way Linear's "Import issues" does, and admins can invite people from
the sidebar. Both sit in a "Try" section at the bottom of the sidebar, as in Linear.

## Goals

### Sidebar "Try" section

- A collapsible **Try** section at the bottom of the sidebar (Linear's layout) with
  **Import issues** (opens Settings → Workspace → Import) and **Invite people** (opens
  the existing invite form as a dialog). Each item shows only to those allowed to use
  it: Import issues for workspace owners and admins, Invite people for those the
  organization's invite rules allow. With neither allowed, the section is hidden.
- No "Link GitHub" item.

### Extra email addresses (for people matching)

- Settings → Account → Profile gains **Email addresses**: the sign-in address and any
  extra addresses, with Add and Remove. Adding one sends a confirmation link to it
  (the same mail transport as sign-in links); an address counts only once confirmed
  ("Pending" until then).
- Extra addresses are used only for import people matching: not for sign-in, not shown
  to other members, never in `/graphql` (Linear's `User` has one `email`). They are
  managed through `/api/auth/instance/account/emails*` (user's decision).
- An address belongs to at most one user, cannot be another user's sign-in address, and a
  user has at most 10 extra addresses.

### Import page (Settings → Workspace → Import, owners and admins)

- Pick a source: **GitHub**, **GitLab**, **Gitea**, **Forgejo**.
- **GitHub (Linear's way):** "Connect GitHub" installs this instance's GitHub Import App
  and authorizes it through OAuth (`integrationGithubImportConnect(code,
  installationId)`); the repositories the installation can see are listed
  (`integrationGithubImportRefresh` refreshes them); the admin picks one or more
  repositories, the destination team (existing, or a new team name), whether to include
  closed issues, and optional label filter, then starts the import with
  `issueImportCreateGithub(githubRepoIds, githubLabels, includeClosedIssues, teamId |
  teamName, instantProcess: false)`. The connection is stored as a workspace integration
  (`githubImport` service) and can be disconnected. github.com only: Linear's
  `integrationGithubImportConnect` has no host argument (builder's call).
- **GitLab, Gitea, Forgejo:** server address (any address, including private network
  addresses and internal hostnames, http or https; redirects are not followed; only
  owners and admins can start an import — user's decision) (gitlab.com prefilled for GitLab), a
  personal access token, then a repository picked from the list the token can see, the
  destination team, include closed issues and optional label filter. These go through
  this instance's own endpoints under `/api/auth/instance/imports*` (Linear's schema has
  no import for them). The token is used for that import only and is never written to
  the database; it is held in memory by the API process running the import.
- **People matching (Linear's mapping review):** every import first fetches the source
  data (status `inProgress`), then the page lists each person found in the source with
  their issue count ("octocat (12 issues)") and a member picker, prefilled where the
  source email matches a member's sign-in address or one of their confirmed extra
  addresses, or the source name or username equals a
  member's name exactly (case-insensitive); the admin confirms or changes each and
  starts processing. For GitHub this is Linear's `issueImportProcess(issueImportId,
  mapping)` with the people in `mapping`; for the other three the matching endpoint of
  `/api/auth/instance/imports*`. Unmatched people leave issues unassigned and the
  importing admin as creator (user's decision).
- **Imports list:** every import with source, repository, team, who started it, status,
  progress ("Imported 120 of 450 issues") and, when done, a summary (issues, comments,
  labels created, skipped items with reasons). Polled while an import runs. The admin
  may leave the page.
- Imports of all four sources are stored as Linear's `IssueImport` (service `github`,
  `gitlab`, `gitea`, `forgejo`; status `inProgress` → `inProcess` → `complete`, or
  `error`); `IssueHistory.issueImport` on an imported issue's creation entry links the
  issue to its import, so its activity reads "imported from GitHub".

### What an import brings across

- **Issues** (pull / merge requests are skipped): title; description as Markdown as
  written; state: open → the team's first `unstarted` state, closed → its first
  `completed` state, GitHub "closed as not planned" → its first `canceled` state;
  original creation date (and completion date for closed issues). `issueCreate` and
  `commentCreate` accept `createdAt` (and `issueCreate` `completedAt`) from every API
  caller, as Linear does, with Linear's rules: in the past; `completedAt` needs a
  completed state and is not before `createdAt` (builder's call).
- **Labels** matched by name (case-insensitive) to the team's or workspace labels; missing
  ones are created on the team with the source colour.
- **Comments** in order with their original dates, each starting
  "**Name** on GitHub wrote:" (or GitLab / Gitea / Forgejo), since the authors usually
  have no account here.
- **Assignee and creator** from the people matching above (members of the destination
  team); unmatched → unassigned, and the importing admin is the creator.
- **Link back:** each issue gets an attachment linking to the source issue
  (title "GitHub #123"). Re-running an import of the same repository into the same team
  skips issues whose source link already exists there, so nothing is duplicated.
- **Not imported:** milestones, reactions, attachments' binary files (images stay as
  links to the source), events (label / assignee history), locked or deleted items.
- An import is a system change: it runs no workflow automations, sends no notifications
  and no webhooks of any kind (Issue, Comment, Attachment, IssueLabel). Matched creators
  and assignees are subscribed to their issues as usual, without notifications
  (builder's call).

### Running an import

- The API runs each import as a background task inside its own process (not a child
  process). On startup, imports left `inProgress` or `inProcess` become `error`. GitHub imports use a
  token for the app installation, fetched when needed and held in memory. If the API
  restarts mid-import, the import ends as `error` with "Interrupted, run the import
  again"; running it again skips what already came across.
- One import at a time per destination team. Source API rate limits are respected
  (wait and retry on 403 / 429 with the source's reset headers).

### Setup (instance)

- GitHub imports need a GitHub App registered for the instance once: environment
  variables for its app id, client id, client secret, private key and app slug (names in
  `.env.example`, and the compose files), and the OAuth callback URL set in the app.
  Without them, GitHub shows "GitHub imports are not set up on this instance" with a
  link to the setup guide. The guide (in `docs/`) lists the app's permissions:
  Issues read-only and Metadata read-only, plus the callback URL.

## Non-goals

- Ongoing sync, two-way sync, importing pull requests, Jira / Asana / Shortcut / CSV,
  mapping statuses or labels by hand (only people are matched), undoing an import
  (`issueImportDelete`), GitHub Enterprise, Link GitHub.

## Anti-goals

- A source token written to the database or logs.
- An import that duplicates issues when run again.
- An import that slows the app for other people beyond its own work, or sends
  notifications and webhooks for every imported issue.
- Controls offered to someone the API refuses.

## Constraints

- Linear's SDL is never edited. Incremental migrations. Follow the project's AGENTS.md
  files and DESIGN.md. Settle open choices the way Linear does.

## Approaches

1. **Linear's import model for GitHub, the instance's own endpoints for the other three
   (chosen by the user).** GitHub follows Linear's API (`integrationGithubImportConnect`,
   `issueImportCreateGithub`); GitLab, Gitea and Forgejo, which Linear has no import
   for, use `/api/auth/instance/imports*` with a pasted token; every import is recorded
   as `IssueImport`.
2. **Own endpoints for all four, running in the API.** Simplest, but GitHub would not
   follow Linear's API.
3. **Worker runs imports.** Survives restarts, but the token would have to be stored.

For GitHub, the user chose Linear's GitHub Import App (registered once per instance,
connected through OAuth) over a pasted GitHub token.

## Left to the builder

The `issue_import` and integration table shapes, endpoint paths and payloads, how
progress is polled (an endpoint under `/api/auth/instance/imports*`, since Linear's
schema has no query for an import), the per-source API clients (Gitea and Forgejo
share one), page layout, and the order of the work.

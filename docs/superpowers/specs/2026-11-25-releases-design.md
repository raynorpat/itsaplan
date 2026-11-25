# Release tracking

## Intent

The team wants to know which issues went out in which release without keeping a list by
hand, and the people who asked for those issues want to hear that they shipped. Linear
does the first with release pipelines synced from CI. This project adds Linear's release
tracking and connects completed releases to the requester updates of feedback project 4.

## Goals

### Pipelines (Linear's `ReleasePipeline`)

- A pipeline has a name, slug, teams (at least one; its issues come from those teams),
  a type, whether it is production, path patterns (`includePathPatterns`, kept and
  returned; this instance does not read commit file paths, builder's call), and for
  scheduled pipelines `rolloverIssuesOnCompletion` (default true).
- **Continuous** (default): each sync creates a release named and versioned after the
  commit (`version` defaults to the first 7 characters of the SHA; a repeated version
  must have the same full SHA), completed at once.
- **Scheduled:** a release collects issues until someone completes it; a sync adds issues
  to the open release (the one named by `version`, else the latest started, else the
  planned one with the earliest target date, else a new planned one).
- **Stages** (Linear's `ReleaseStage`): each pipeline gets Planned, In progress,
  Completed and Canceled on creation (types `planned`, `started`, `completed`,
  `canceled`); a scheduled pipeline's stages can be renamed, recoloured, reordered and
  more `started` stages added (e.g. "QA", "Staging"); a `frozen` stage takes no new
  issues from syncs: a sync aimed at a frozen release puts its issues in the next open
  release that is not frozen (a new planned one when none), and `version` naming a
  frozen release does the same and says so in the answer (builder's call: Linear's code
  freeze sends new work to the next release). Continuous pipelines keep the four
  (builder's call).
- Owners, admins and members of the pipeline's teams create and edit pipelines; a
  pipeline is visible to whoever sees one of its teams; archive, unarchive and delete as
  Linear (delete trashes). Guests see pipelines of their teams and cannot edit.

### Releases (Linear's `Release`)

- Name, version, description, commit SHA, stage, start / target dates, started /
  completed / canceled times, creator, slug and url, links (`ReleaseLinkInput`: URL and
  label), documents (title and Markdown), issues, `issueCount`, `currentProgress` and
  `progressHistory` (issue counts by state type, the project progress rule), `history`.
- **Issues:** `issueToReleaseCreate` / `Delete` / `DeleteByIssueAndRelease` by hand (the
  issue's team must be one of the pipeline's teams), `Issue.releases`, and a **Release**
  property on the issue page (add / remove; shows each release with its pipeline and
  stage). An issue may be in several releases (one per pipeline in practice;
  builder's call: not enforced, as Linear).
- **Completing** a release (`releaseComplete`, or moving it to a completed stage) sets
  `completedAt`; in a scheduled pipeline with rollover, its issues that are not completed
  or canceled move to the next planned release (created when none, named "Next"
  builder's call). Canceling sets `canceledAt` and keeps the issues.
- Archive, unarchive, delete (trash) as Linear; `releaseSearch` by name / version.

### Syncing from CI (user's choice)

- **Access keys** (Linear's `AccessKey`): workspace owners and admins create keys (as
  for webhooks; team owners see the key list read-only, builder's call) for a pipeline in
  its settings (Linear's SDL has no mutation for it: through
  `/api/auth/instance/access-keys*`); a key is shown once, stored hashed, can be revoked,
  and records `lastUsedAt`. A key acts only on its pipeline and only for the
  `*ByAccessKey` operations.
- `releaseSyncByAccessKey`, `releaseUpdateByPipelineByAccessKey` and
  `releaseCompleteByAccessKey` take the key as `Authorization: Bearer <key>`; the same
  operations without the suffix (`releaseSync`, `releaseUpdateByPipeline`,
  `releaseComplete`) are for signed-in users and API keys with access to the pipeline.
- **`releaseSync`** follows Linear's input: commit SHA, version, name, description,
  `issueReferences` (identifier + commit; missing or archived issues and issues outside
  the pipeline's teams are skipped), `revertedIssueReferences` (scheduled only), links and
  documents (upserted by URL / title), release notes (upserted), repository data (kept
  on the release). `pullRequestReferences` are skipped (no code-host integration here).
  The answer lists what was added and skipped.
- **Docs:** `docs/release-sync.md` with a GitHub Actions step and a GitLab CI job that
  collect issue identifiers from the commits since the last release (`git log` between
  the previous and current SHA, matching team keys) and call `releaseSyncByAccessKey`
  with `curl`. The last synced commit is read from the pipeline's latest release
  (builder's call: the script asks the API for it).

### Release notes (Linear's `ReleaseNote`, user's choice)

- A release note is a Markdown document for one or more releases of a pipeline:
  `releaseNoteCreate` / `Update` / `Delete`, `Release.releaseNotes`,
  `ReleasePipeline.latestReleaseNote`.
- **Write** by hand in the release page's editor, or **Fill from issues**: a draft listing
  the release's completed issues grouped by label ("Features", "Bug fixes", "Other"),
  each with its title and identifier. No AI.
- `autoGenerateReleaseNotesOnCompletion` (default false): when on, completing a release
  creates the filled draft when the release has none.

### "Shipped" updates to requesters (user's choice)

- An issue **ships** when three things are all true: it is in a release, that release
  is completed, and the issue itself is completed (builder's call: an issue still in
  progress is never called shipped, so this never contradicts the status emails). It
  ships at the latest of the three moments, so an issue added to a completed release, or
  completed after its release, ships then.
- Every person following a shipped issue (project 4: active feedback or a portal thread,
  updates on) gets the change "Shipped in <release name>" in their next change email,
  summary and "Since your last visit", once per person, issue and release (a sent record
  per person, issue and release; builder's call). A release canceled after completing
  sends nothing more and retracts nothing already sent.
- Same access rules as project 4's status changes: only issues the person may read on a
  board (with a link to the board's page), or where they have form or team-logged
  feedback (title only). Only releases of **production** pipelines are sent (builder's
  call: a staging deploy is not "shipped"). A release completed and then reopened is not
  sent twice.
- The portal issue page shows "Shipped in <release> on <date>" for such issues (builder's
  call), from the same rule.

### Pages

- **Releases** in each team's sidebar items (like Cycles), listing the pipelines of that
  team; a pipeline page lists its releases (stage, version, issues, dates) with a board
  by stage for scheduled pipelines; **New release** for scheduled pipelines.
- **Release page:** name, version, stage selector, dates, description, links, documents,
  the issues list (grouped by state), the progress bar, release notes (editor and Fill
  from issues), Complete / Cancel, Archive.
- **Pipeline settings** (team settings → Releases): create and edit pipelines, stages,
  access keys (create, copy once, revoke, last used), and a link to the CI docs.

## Non-goals

- GitHub / GitLab code-host integration, pull-request references, path filtering of
  commits, AI-written release notes, release notes published to the portal or as a
  public changelog, Slack notifications, release calendars across pipelines.

## Anti-goals

- An access key that can read or change anything beyond its pipeline's releases.
- A requester told about an issue they cannot see, or told twice.
- A sync silently adding issues from teams outside the pipeline.

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations. Follow
  the AGENTS.md files and DESIGN.md. Settle open choices the way Linear does.
- Web features do not import each other; shared code goes in the shared layer.
- Release and pipeline webhooks are not sent (Linear's webhook resource list has none
  for releases; builder's call).

## Approaches

1. **Linear's full model with CI sync (chosen by the user).** Pipelines, stages, releases,
   issue links, release notes, access keys and `releaseSync`; releases fill in from CI.
2. Releases by hand only. Rejected: someone must add every issue to every release, and
   Linear clients using `releaseSync` would not work.
3. Releases from Git tags through a code-host integration. Rejected: no such integration
   exists here, and it would tie releases to one host.

## Left to the builder

Table shapes, the access key format and hashing, the CI script details, the release page
layout within DESIGN.md, the progress JSON shape (following Linear's
`currentProgress`), and the order of the work.

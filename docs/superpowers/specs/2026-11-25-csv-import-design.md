# CSV issue import

## Intent

Teams move in from Jira and from tools that only offer a spreadsheet export. Linear
imports Jira CSV exports and a generic CSV with column mapping; this instance imports
from GitHub, GitLab, Gitea and Forgejo today. This adds Jira CSV (user's choice, with
Linear's API for it) and a generic CSV with a mapping step (user's choice), through the
existing import flow.

## Goals

### Upload and sources

- The file is uploaded with the existing `fileUpload` mechanism as an **import file**
  (builder's call): it skips the workspace's attachment type allowlist, accepts
  `text/csv`, `application/vnd.ms-excel`, `text/plain` or no type, at most
  `MAX_ATTACHMENT_MB`, is never served by the public raw route, and is deleted when the
  import ends (completed, error or expired). It is named by its asset URL.
  UTF-8 with or without a BOM; comma or semicolon delimiter detected from the header
  line; quoted fields with embedded newlines; at most 10,000 rows (builder's call:
  more is INVALID_INPUT "At most 10,000 rows per import").
- **Jira CSV** (Linear's `issueImportCheckCSV(csvUrl, service: "jira")` and
  `issueImportCreateCSVJira(csvUrl, teamId | teamName, jiraEmail?, jiraHostname?,
  jiraToken?)`): a fixed reading of Jira's export — Summary → title, Issue key → source
  key, Description, Status, Priority (Highest → Urgent, High → High, Medium → Medium,
  Low and Lowest → Low; anything else no priority), Assignee and Reporter (names /
  emails into the people step), Created, Resolved, Due date, every `Labels` column,
  every `Comment` column (`date;user;text`), Story Points (onto the team's estimate
  scale: kept when on the scale, else left empty; builder's call). Jira wiki markup in
  descriptions and comments is converted to Markdown for the common forms (headings,
  bold, italic, monospace, `{code}` and `{noformat}` blocks, `{quote}`, links
  `[text|url]`, bullet and numbered lists, tables as plain rows; images `!x.png!` become
  their file name in text) (builder's call). `issueImportCheckCSV` answers success for a
  file that reads as a Jira export (a Summary column) and INVALID_INPUT "The file is not a
  Jira CSV export (no Summary column)" otherwise. The Jira credentials are accepted and
  not used: this instance does not call Jira (builder's call). Jira CSV is offered on the
  Import page too, with the same Statuses and People steps (builder's call).
- **Generic CSV** on the Import page (through `/api/auth/instance/imports*`, as the
  GitLab / Gitea sources): after upload, a **Columns** step shows the file's headers
  with a sample value each and guesses the mapping by header name: title (required),
  description, status, priority, assignee, creator, labels (one column, split on commas
  or semicolons), created date, due date, completed date, estimate, ID (source key), and
  the **date format** (ISO, day first, month first; guessed from the values: a first
  part above 12 means day first, else month first unless the values are ISO). The
  person corrects it before continuing. Unmapped columns are ignored.
- **Dates** (builder's call): Jira dates in Jira's export forms (`25/Nov/26 10:15 AM`,
  ISO) are read in UTC; generic dates in the chosen format, in UTC; a created date that
  is empty or does not parse takes the import time and is counted in the summary.

### Steps after reading the file

- **Statuses** (both sources): every distinct status value in the file is mapped to one
  of the destination team's workflow states, guessed by name (case-insensitive) and
  then by meaning ("done", "closed", "resolved" → the first completed state; "cancel",
  "won't do" → the first canceled; "in progress", "review" → the first started; else
  the team's default state); the person can change each. An empty status takes the
  team's default state. A new team (by `teamName`) gets the default states, and the
  step maps onto those.
- **Through the API** (builder's call): the file's distinct status values are listed in
  the import's `serviceMetadata.statuses` once it is read, and
  `issueImportProcess` / `issueImportUpdate` take `mapping.statuses` as
  `{ "<status value>": "<state id or state name>" }`; values left out use the guess. For
  a team the import creates, names refer to its default states.
- **People:** the existing people step (names and emails from assignee, creator /
  reporter and comment authors).
- **Processing:** the existing engine creates issues (title, description, state from the
  status mapping, priority, assignee, creator as a history note as the existing sources
  do, labels matched by name or created, dates as Linear's import dates, estimate when
  the team uses estimates and the value is on its scale), comments ("**Name** wrote:"
  as the existing sources), and records each row's **source key** so a re-run skips rows
  already imported and completes half-written ones, as today. The key is
  `jira:<Issue key>` or `csv:<ID column value>` within the destination team (so a newer
  export of the same project skips what it already has), or, without either,
  `csv:<file content hash>:<row number>` (so only a re-run of the identical file skips
  rows) (builder's call).

### Limits and safety

- A row without a title is skipped and listed in the import's summary with its row
  number; a date that does not parse is left empty; a priority or estimate that does not
  map is left empty and counted in the summary (builder's call).
- Owners and admins import, as for the other sources; the file is deleted from storage
  when the import ends (completed, error or expired) (builder's call).

## Non-goals

- Asana, Shortcut, Trello or Linear-CSV presets (the generic mapping covers them);
  attachments, sub-issues, links between rows, sprints / cycles, custom fields,
  calling the Jira API with the given credentials, exporting CSV.

## Anti-goals

- A re-run of the same file creating duplicate issues.
- A malformed file creating some issues and then failing without saying which.
- Formula-like cell values executed or kept as formulas anywhere (they are plain text).

## Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations if any.
  Follow the AGENTS.md files and DESIGN.md; reuse `imports/flow.ts`, the people step and
  the engine.

## Approaches

1. **CSV as another source in the existing import flow (chosen by the user).** One flow,
   re-run safety, the people step and Linear's Jira CSV operations.
2. Parse in the browser and create issues one by one. Rejected: no re-run safety or
   people step, slow on large files, no Linear Jira CSV operations.

## Left to the builder

The CSV parser (a small dependency or own code), where the source key is stored, the
Columns and Statuses step layouts within DESIGN.md, guess heuristics beyond those named,
and the order of the work.

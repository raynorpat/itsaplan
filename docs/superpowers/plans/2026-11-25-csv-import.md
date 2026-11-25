# CSV Issue Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import Jira CSV exports (with Linear's API for them) and generic CSVs with column and status mapping through the existing import flow.

**Architecture:** Import files are a kind of upload; `imports/csv/` holds a CSV parser, a Jira reader (with wiki-to-Markdown), a generic reader driven by a column mapping, and date / status / priority guessing, all producing the existing `SourceData` extended with per-row source keys, statuses, priority, estimate and dates. The flow gains a Statuses step; the engine dedupes on source keys and maps statuses to states.

**Tech Stack:** Bun, Drizzle/Postgres, graphql-yoga with Linear's SDL, better-auth instance plugin, Next.js 15, gql.tada.

**Spec:** `docs/superpowers/specs/2026-11-25-csv-import-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations if any. Follow the AGENTS.md files and DESIGN.md; reuse `imports/flow.ts`, the people step and the engine.
- At most 10,000 rows ("At most 10,000 rows per import"); UTF-8 with or without BOM; comma or semicolon from the header line.
- Jira priority: Highest → 1 (Urgent), High → 2, Medium → 3, Low and Lowest → 4, else 0.
- Source keys: `jira:<Issue key>`, `csv:<ID value>` per destination team; else `csv:<sha256 of file>:<row number>`.
- `issueImportCheckCSV` failure: INVALID_INPUT "The file is not a Jira CSV export (no Summary column)".
- Cell text is never interpreted as a formula. Owners and admins import.
- Commits: one per task, no trailer or metadata.

## Review Focus

1. A Jira export where the same header repeats (`Labels`, `Labels`, `Comment`, `Comment`) keeps every value. Test in Task 2.
2. A quoted cell with commas, quotes (`""`) and newlines parses as one value. Test in Task 1.
3. Re-running the same Jira export into the same team after a crash halfway creates no duplicates and finishes the half-written issue. Test in Task 3.
4. A generic CSV with `03/04/2026` and the format set to day first gives 3 April. Test in Task 2.
5. The uploaded file is not readable through `/uploads/:id/raw` and is gone after the import ends. Test in Task 1 and Task 3.

---

### Task 1: Import files and the CSV parser

**Files:** `apps/api/src/uploads/*` (an `import` purpose on `fileUpload`/the upload store; allowlist skipped for it; accepted types `text/csv`, `application/vnd.ms-excel`, `text/plain`, empty; raw route refuses import files; `deleteImportFile(assetUrl)`), `apps/api/src/imports/csv/parse.ts` (new); tests `apps/api/src/imports/csv/__tests__/unit/parse.test.ts`, an uploads integration test.

**Interfaces:**
- Produces: `parseCsv(text: string): { headers: string[]; rows: string[][] }` (BOM stripped, delimiter detected, RFC 4180 quoting, CRLF / LF, repeated headers kept by position, at most 10,000 data rows else `HttpError(400, 'At most 10,000 rows per import')`); `readImportFile(user, assetUrl): Promise<{ text: string; sha256: string }>` (owner of the upload only); how a client requests an import upload (Linear's `fileUpload` has `metaData`/`makePublic` args — use `metaData: { purpose: "import" }`; ledger if different).
- [ ] **Step 1: Failing tests:** parse cases (quotes, embedded `""`, newlines, semicolon file, BOM, empty trailing line, 10,001 rows refused — Review Focus 2); an import upload with `application/vnd.ms-excel` is accepted even when the workspace allowlist excludes it; `GET /uploads/:id/raw` of an import file → 404 (Review Focus 5); another user cannot read it.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/imports src/uploads` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): import files and CSV parsing`

### Task 2: Jira and generic CSV readers

**Files:** `apps/api/src/imports/csv/{jira,generic,wiki,dates,guess}.ts` (new), `apps/api/src/imports/types.ts` (extend `SourceIssue` with optional `sourceKey`, `status`, `priority`, `estimate`, `dueDate`, `completedAt`, `creator`), unit tests per file.

**Interfaces:**
- Produces: `readJiraCsv(parsed, sha256): CsvSource` and `isJiraCsv(headers): boolean`; `ColumnMapping = { title: number; description?; status?; priority?; assignee?; creator?; labels?; createdAt?; dueDate?; completedAt?; estimate?; id?; dateFormat: 'iso' | 'dayFirst' | 'monthFirst' }`; `guessColumns(headers, sampleRows): ColumnMapping`; `readGenericCsv(parsed, mapping, sha256): CsvSource`; `CsvSource = { data: SourceData; statuses: string[]; skipped: { row: number; reason: string }[]; counts: { badDates: number; badPriority: number; badEstimate: number } }`; `wikiToMarkdown(text): string`; `parseJiraDate(s)`, `parseDate(s, format)` → ISO in UTC or null; `guessStatusState(value, states): stateId`; `parsePriority(value): 0..4 | null`.
- [ ] **Step 1: Failing tests:** Jira fixture with repeated Labels/Comment headers (Review Focus 1), comment `date;user;text`, priorities per the constraint, Story Points; wiki conversions (h2., *bold*, _italic_, {{mono}}, {code}, {quote}, [text|url], `*` / `#` lists, `!img.png!` → `img.png`); `25/Nov/26 10:15 AM` → `2026-11-25T10:15:00.000Z`; generic guessing from headers ("Title"/"Summary"/"Name", "Status"/"State", …); `03/04/2026` dayFirst → April 3 (Review Focus 4) and monthFirst → March 4; the date-format guess (a first part > 12 → dayFirst); a row without a title skipped with its row number; status guesses ("Done" → completed, "Won't do" → canceled, "In Review" → started, unknown → default).
- [ ] **Step 2: Run** `cd apps/api && bun test src/imports/csv` (unit) — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Jira and generic CSV readers`

### Task 3: CSV imports through the flow and the API

**Files:** `apps/api/src/imports/{flow,engine,store,handlers}.ts`, `apps/api/src/graphql/resolvers/issue-import.ts`, `packages/auth/src/instance-plugin.ts` (generic CSV endpoints), `apps/api/AGENTS.md`, `packages/auth/AGENTS.md`; integration test `apps/api/src/imports/__tests__/integration/csv.test.ts`.

**Interfaces:**
- Produces:
  - GraphQL `issueImportCheckCSV(csvUrl, service: "jira")`, `issueImportCreateCSVJira(csvUrl, teamId | teamName, jira*)` → an import in `inProgress` with `serviceMetadata.statuses` (distinct values) and the people step; `issueImportProcess` / `issueImportUpdate` accept `mapping.statuses` (`{ value: stateId | stateName }`) alongside `mapping.people`.
  - Instance endpoints: `POST /instance/imports/csv/preview` `{ assetUrl }` → `{ headers, sample: string[][], guess: ColumnMapping, jira: boolean }`; `POST /instance/imports/csv/create` `{ assetUrl, source: 'jira' | 'generic', mapping?, teamId | teamName }` → the import; the Import page's existing people / process endpoints take `statuses` too.
  - Engine: dedupe on `sourceKey` per destination team (stored with the import link record — builder's call where; no public URL needed), state from the status mapping (guess for unmapped), priority, estimate only when valid on the team's scale, dates as import dates, comments; the summary lists skipped rows and counts; the import file is deleted when the import ends (complete, error, expired).
- [ ] **Step 1: Failing tests:** a Jira CSV end to end through GraphQL (check → create → process with `mapping.statuses`) creating issues with the mapped states, labels, comments, priority; the check refusing a non-Jira file with the constraint's message; a generic CSV through the instance endpoints with a column mapping; re-run after a simulated crash halfway (Review Focus 3); a different file with row-number keys into the same team skips nothing; the file is deleted after completion (Review Focus 5); members → 403.
- [ ] **Step 2: Run** `cd apps/api && bun run test src/imports` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `cd apps/api && bun run test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): CSV issue imports`

### Task 4: CSV on the Import page

**Files:** `apps/web/src/features/imports/*` (a "CSV" source with Jira / Generic choice, upload with `purpose: import`, Columns step for generic, Statuses step for both, then the existing People step and processing), its services and utils (+ tests).

**Interfaces:**
- Consumes: Task 3 endpoints.
- Produces: `statusOptions(states)` and `columnLabel(key)` utils; the Columns step shows each header with a sample value and a field select (title required) and a date format select; the Statuses step lists each status value with a state select (pre-filled with the guess).
- [ ] **Step 1: Failing tests** for the utils (column validation: title required, one column per field; status rows built from `serviceMetadata.statuses` and states).
- [ ] **Step 2: Run** `cd apps/web && bun test src/features/imports` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** root `bun run format:check && bun run lint && bun run typecheck && bun run build`, `cd apps/web && bun test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): CSV import on the Import page`

# Requester Updates and Summaries (Feedback Project 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Requesters who opted in get grouped change emails, shared project updates and weekly / daily summaries, and see "Since your last visit" on the portal, with summaries optionally written by an OpenAI-compatible model.

**Architecture:** Task 1 adds preferences, consent and unsubscribe. Task 2 is the one "what changed since" lookup over issue history and comments, with access rules, plus shared project updates. Task 3 sends change emails and summaries from worker-triggered internal routes. Task 4 adds the AI endpoint and the portal's "Since your last visit". Tasks 5–6 build the web.

**Tech Stack:** Bun, Elysia, Drizzle, `@repo/mailer`, the worker tick loop, the portal routes and session; Next.js 15, React 19, TanStack Query 5; `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-24-requester-updates-design.md`

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations (next is 0057).
- Nothing is sent unless the main switch is on, the requester has an email, is not blocked and not merged; unsubscribed people are never turned on again by a sign-in or a member.
- Existing requesters start with updates off; confirming a portal sign-in or a form turns them on unless unsubscribed.
- Only public-team, non-trashed issues; replies only from portal threads of boards the person can read now; status for form / team-logged feedback issues even off-board (title and status only, no link); internal comments never.
- Change emails at most one per person per 10 minutes; one change never in two change emails. Summaries: weekly (Mondays 08:00 UTC) by default, daily or off; only when something is new since the last summary.
- No mail provider → nothing sent, nothing marked.
- Every email: unsubscribe link and `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 8058); no tracking pixels; sender name = workspace name.
- AI: OpenAI-compatible `POST {baseUrl}/chat/completions`; 20 s timeout or any error → round-up alone; key encrypted at rest, never returned; only what the person may see is sent.
- The worker never holds mail or model credentials; it calls the API's internal routes.
- Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. A person who loses access to a restricted board (domain removed) between two runs while a reply is waiting in that board's thread: the reply is not sent. Test in Task 2.
2. The worker running twice at once, or crashing between sending and marking: no change in two emails (claim the person row before sending; mark in the same transaction as the claim's release). Test in Task 3.
3. A burst of 12 status flips on one issue within 10 minutes, ending where it started: one email at most, and none when the public status ends unchanged. Test in Task 2 / Task 3.
4. An AI endpoint that hangs, returns 500, returns non-JSON or a reply over 2,000 characters: the round-up is used, cut model text never shown, no exception escapes the run. Test in Task 4.
5. One-click unsubscribe POSTed by a mail provider with no cookie and no Origin header, and a forged or old token: valid token turns everything off; forged → 400; nothing else changes. Test in Task 1.

---

### Task 1: Preferences, consent and unsubscribe

**Files:**
- Modify: `packages/db/src/schema/app.ts` + migration 0057: `external_user` gains `updates_enabled` bool default false, `updates_unsubscribed_at`, `change_emails` bool default true, `summary_cadence` text `'weekly' | 'daily' | 'off'` default `'weekly'`, `changes_sent_until` timestamptz, `last_change_email_at`, `summary_sent_until`, `last_visit_at`, `previous_visit_at`.
- Create: `apps/api/src/updates/preferences.ts`, `apps/api/src/updates/unsubscribe.ts`
- Modify: `apps/api/src/portal/session.ts` (`confirmSignIn` turns updates on), `apps/api/src/forms/public.ts` (confirm turns updates on), `apps/api/src/portal/routes.ts`, `apps/api/src/feedback/requesters.ts` (DTO gains `updates: { enabled, unsubscribed }`), instance plugin + handlers
- Test: `apps/api/src/updates/__tests__/integration/preferences.test.ts`

**Interfaces:**
- Produces:
  - `type UpdatePrefs = { enabled: boolean; unsubscribed: boolean; changeEmails: boolean; summary: 'weekly' | 'daily' | 'off' }`; `getPrefs(requesterId): Promise<UpdatePrefs>`; `optIn(requesterId): Promise<void>` (no-op when unsubscribed); `setPrefs(requesterId, patch: Partial<Pick<UpdatePrefs, 'enabled' | 'changeEmails' | 'summary'>>, by: 'person' | 'team'): Promise<UpdatePrefs>` (`team` may only set `enabled`, and not when unsubscribed → 409; `person` setting `enabled: true` clears `unsubscribed`).
  - `unsubscribeToken(requesterId): string` = `<requesterId>.<base64url HMAC-SHA256(BETTER_AUTH_SECRET, "unsubscribe:" + requesterId)>`; `verifyUnsubscribeToken(token): string | null` (timing-safe).
  - Routes: `GET /portal/me/updates` / `POST /portal/me/updates` (signed-in visitor); `GET /portal/unsubscribe?token` → `{ email (masked "j***@acme.com"), prefs }`; `POST /portal/unsubscribe { token, summary? }` (page button: turns all off, or with `summary` keeps the main switch and sets only the cadence); `POST /portal/unsubscribe/one-click?token` (RFC 8058: no Origin check, no cookie, turns all off, 200 empty).
  - Instance endpoint (members): `POST /instance/requesters/updates { requesterId, enabled }` → `by: 'team'`.

- [ ] **Step 1: Failing tests:** new requester defaults off; portal sign-in confirm turns on; form confirm turns on; after unsubscribe a sign-in does not turn on and the team endpoint → 409; person re-enables from `/portal/me/updates`; one-click POST without Origin turns off; forged token → 400; token of another requester never changes this one; masked email shape; guest refused on the team endpoint.
- [ ] **Step 2: Run** `cd apps/api && bun test src/updates` — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite (object-store tests excepted), root `format:check`, `lint`, `typecheck` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): requester update preferences`

### Task 2: The changes lookup and shared project updates

**Files:**
- Modify: schema + migration 0058: `project_update_share` (project_update_id PK references project_update on delete cascade, shared_by_id, shared_at).
- Create: `apps/api/src/updates/changes.ts`, `apps/api/src/updates/share.ts`
- Modify: instance plugin + handlers
- Test: `apps/api/src/updates/__tests__/integration/changes.test.ts`

**Interfaces:**
- Consumes: Task 1; portal `canReadBoard`, `boardsShowingIssue`, `publicStatus`; `issue_activity` state changes; comments with `portal_thread` / `portal_board_id` / `external_user_id`; project 1 needs and their attachment `metadata.source`.
- Produces:
  - `type Change = { kind: 'status'; issueId; identifier; title; from: PublicStatus | 'underReview' | null; to: PublicStatus | 'closed'; duplicateOf: { title: string; url: string | null } | null; url: string | null; at: Date } | { kind: 'reply'; issueId; identifier; title; author: string; body: string; url: string | null; at: Date } | { kind: 'projectUpdate'; projectName; health: 'onTrack' | 'atRisk' | 'offTrack' | null; body: string; at: Date }`.
  - `requesterChanges(requesterId: string, since: Date, until: Date): Promise<Change[]>` ordered by `at`. Status: per issue, compare the public status at `since` with the public status at `until` (from the issue history), emit one change only when they differ (`from` = `underReview` when it was in triage, `reopened` shown by the email when `from` is `done` / `closed`); canceled → `closed`, with `duplicateOf` from the issue's duplicate relation. Replies: comments created in the window by someone other than the person, in portal threads the person wrote in, on boards the person can read at `until`. Project updates: shared in the window, of projects with an issue the person follows. Followed issue set and access rules as in Global Constraints. `url` = `${APP_URL}/portal/<slug>/<identifier>` for the first board (by name) the person can read that shows the issue, else null.
  - `requestersWithChangesSince(since: Date): Promise<string[]>` — candidate requester ids (updates on, email, not blocked / merged) who follow an issue with history, a comment or a shared project update after `since`; used by Task 3 to avoid scanning everyone.
  - Instance endpoint (members who can see the project): `POST /instance/project-updates/share { projectUpdateId }` (idempotent; only the update's author or an admin).

- [ ] **Step 1: Failing tests:** status planned → in progress emitted once with from / to; 12 flips ending at the start → none; triage → backlog emitted with `from: 'underReview'`; done → started emitted; canceled with duplicate relation → `closed` + `duplicateOf`; reply by a member in the person's portal thread emitted; internal comment not; reply in a thread of a board the person lost access to (domain removed) not; private-team issue not; team-logged feedback issue on no board → status with `url: null`, replies not; vote on an issue no longer readable → nothing; shared project update emitted, unshared not; `requestersWithChangesSince` excludes updates-off, blocked and merged people; share endpoint idempotent, guest refused.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): requester changes lookup and shared project updates`

### Task 3: Change emails and summaries

**Files:**
- Create: `apps/api/src/updates/{run.ts, render.ts, internal-routes.ts}`, `apps/worker/src/requester-updates.ts`
- Modify: `packages/mailer/src/index.ts` (`EmailMessage.headers?: Record<string, string>`, passed to SMTP and Resend), `apps/api/src/app.ts`, `apps/worker/src/worker.ts` (call `POST /internal/requester-updates/changes` every tick that is ≥ 2 minutes since the last call, and `POST /internal/requester-updates/summaries` every tick ≥ 15 minutes since the last), `apps/worker/AGENTS.md`, `apps/api/AGENTS.md`
- Test: `apps/api/src/updates/__tests__/integration/run.test.ts`, `apps/api/src/updates/__tests__/render.test.ts`, worker test for the schedule

**Interfaces:**
- Consumes: Tasks 1–2; `getEmailConfig`, `sendEmail`.
- Produces:
  - `runChangeEmails(now: Date): Promise<{ sent: number }>`: for each candidate with `changeEmails` on and (`last_change_email_at` null or ≤ now − 10 min): claim the row (`UPDATE … SET last_change_email_at = now WHERE id = $1 AND (last_change_email_at IS NULL OR last_change_email_at <= now − 10 min) RETURNING`), compute `requesterChanges(id, changes_sent_until ?? updates-on time, now)`, send one email when non-empty, then set `changes_sent_until = now`; on send failure restore `last_change_email_at` and keep `changes_sent_until`.
  - `runSummaries(now: Date): Promise<{ sent: number }>`: due when cadence `daily` and `summary_sent_until` before today 08:00 UTC ≤ now, or `weekly` and before this Monday 08:00 UTC ≤ now; same claim pattern on `summary_sent_until`; content = changes since `summary_sent_until` (or updates-on time), skipped when empty; the text comes from `summaryText(changes, person)` (Task 4 replaces its body to call the model; here it returns the round-up).
  - `roundUp(changes: Change[]): string[]` (one line each: "Dark mode moved to In progress", "Export to CSV: Reopened, In progress", "Bulk edit was closed as a duplicate of Batch edit", "2 new replies on Export to CSV", "Mobile app: On track"), `renderChangeEmail(changes, person, workspaceName, unsubscribeUrl): { subject; text; html }` (subject "Updates on what you asked for", replies quoted in full as plain text, project update bodies as text), `renderSummaryEmail(summaryText, changes, …)` (subject "Your weekly summary" / "Your daily summary").
  - Internal routes guarded like the existing internal routes.

- [ ] **Step 1: Failing tests:** `roundUp` lines for each change kind; render escapes HTML in titles and bodies and contains no `<img`; a person with a status change gets one email with `List-Unsubscribe` headers; a second run within 10 minutes sends nothing; two concurrent runs → one email; a send failure → next run resends the same changes; no mail provider → nothing sent and markers unchanged; change emails off → none, summaries still sent; weekly summary sent once on Monday after 08:00, not on Tuesday; daily summary includes changes already sent by change emails; nothing new → no summary; updates off → nothing; worker schedule calls the two routes at the right intervals.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** full API suite, worker tests, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat: requester change emails and summaries`

### Task 4: AI endpoint and "Since your last visit"

**Files:**
- Modify: schema + migration 0059: `ai_settings` (single row: base_url, model, api_key_ciphertext, updated_by_id, updated_at); `portal_summary_cache` (requester_id PK, day date, text).
- Create: `apps/api/src/shared/secret-box.ts`, `apps/api/src/updates/ai.ts`
- Modify: `apps/api/src/updates/run.ts` (`summaryText` calls `aiSummary` when configured), `apps/api/src/portal/routes.ts`, `apps/api/src/portal/session.ts` (record visits), instance plugin + handlers
- Test: `apps/api/src/updates/__tests__/integration/ai.test.ts`, `apps/api/src/shared/__tests__/secret-box.test.ts`

**Interfaces:**
- Produces:
  - `seal(plain: string): string` / `open(sealed: string): string` — AES-256-GCM, key = HKDF-SHA256(BETTER_AUTH_SECRET, info "ai-settings"), output `v1.<iv>.<tag>.<ct>` base64url.
  - `aiSummary(changes: Change[], person: { displayName: string }): Promise<string | null>` — POST `{ model, messages: [system, user], max_tokens: 400, temperature: 0.3 }` with `Authorization: Bearer <key>`, 20 s `AbortSignal.timeout`; returns `choices[0].message.content` trimmed when 1–2,000 characters, else null; null on any error. The user message holds only the `Change` fields (titles, statuses, reply bodies, project update bodies, project names); the system message asks for 2–4 plain sentences in English, no Markdown, no invented facts.
  - `summaryText(changes, person): Promise<{ paragraph: string | null; lines: string[] }>` (`lines` = `roundUp`).
  - Instance endpoints (owners / admins): `GET /instance/ai` → `{ baseUrl, model, hasKey }`, `POST /instance/ai { baseUrl, model, apiKey? }` (empty `apiKey` keeps the stored one; `baseUrl` http(s) only), `POST /instance/ai/delete`, `POST /instance/ai/test` → `{ ok, error? }` (one short completion).
  - Visits: every portal request by a signed-in visitor sets `previous_visit_at = last_visit_at, last_visit_at = now` when `last_visit_at` is null or older than 1 hour.
  - `GET /portal/me/since-last-visit` → `{ paragraph, lines }` for changes between `previous_visit_at` and now (empty when null); the paragraph cached in `portal_summary_cache` per requester per UTC day.

- [ ] **Step 1: Failing tests:** seal / open round trip, tampered ciphertext throws; `GET /instance/ai` never returns the key; member refused; `aiSummary` against a local stub server: success, 500, hang (timeout shortened through a test-only parameter of `aiSummary(…, { timeoutMs })`), non-JSON, 3,000-character reply → null; the request body sent to the stub contains no internal comment text and no email; a summary email uses the paragraph when the stub answers and the round-up alone when it fails; `since-last-visit` empty on first visit, lists a change after the second visit an hour later, calls the stub once per day.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate.
- [ ] **Step 4: Run** full API suite, root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): ai summaries and since your last visit`

### Task 5: Workspace side in the web

**Files:**
- Create: `apps/web/src/app/settings/workspace/ai/page.tsx`, `apps/web/src/features/ai-settings/{AiSettingsPage.tsx, services/aiSettings.service.ts, utils/aiSettings.ts}`
- Modify: settings nav (Workspace → AI, owners / admins) and its test; `features/feedback/PersonPage.tsx` ("Keep this person updated" switch; "Unsubscribed" shown and the switch disabled when unsubscribed); `components/common/feedback/FeedbackNewRequesterForm.tsx` (checkbox "Keep this person updated", off); project update composer in `features/projects/components/detail/` ("Send to requesters" switch, off; after `projectUpdateCreate` succeeds, call the share endpoint)
- Test: `apps/web/src/features/ai-settings/utils/__tests__/aiSettings.test.ts`

**Interfaces:**
- Produces: `aiFormErrors(form: { baseUrl: string; model: string }): Record<string, string>` (http / https URL, model required), `normalizeBaseUrl(url: string): string` (trims a trailing `/` and a trailing `/chat/completions`).

- [ ] **Step 1: Failing tests** for both helpers.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks incl. build — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): ai settings and requester update controls`

### Task 6: Portal side and smoke check

**Files:**
- Create: `apps/web/src/app/portal/unsubscribe/page.tsx`, `apps/web/src/features/portal/components/{PortalUpdatesSettings, PortalSinceLastVisit, PortalUnsubscribe}.tsx`, `apps/web/src/features/portal/utils/updates.ts`
- Modify: portal account menu (Email updates: main switch, change emails, summary cadence), board page (Since your last visit, dismissible for the session), the portal sign-in confirm page and the form confirm page (notice "We'll email you about what you asked for. You can stop this at any time.")
- Test: `apps/web/src/features/portal/utils/__tests__/updates.test.ts`

**Interfaces:**
- Produces: `cadenceLabel(c): 'Weekly' | 'Daily' | 'Off'`, `updatesSummary(prefs: UpdatePrefs): string` ("Off", "Changes and a weekly summary", "Weekly summary only", "Changes only").

- [ ] **Step 1: Failing tests** for both helpers.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root checks, full API suite; smoke check (test DB, seed; API 3100, web 3101, headless Chrome; mail through a local SMTP sink or the logged mail): visitor signs in (notice shown), votes; member moves the issue to In progress, replies in the visitor's thread, posts a project update with Send to requesters; trigger the internal changes route → one email with the three items and unsubscribe headers; trigger again → none; set a stub AI endpoint in Settings → AI, Test → ok; trigger a summary → paragraph and lines; visitor revisits after an hour (SQL-moved visit time) → Since your last visit; unsubscribe page → off; member's Keep updated switch disabled for that person. Screenshots `<scratchpad>/shots/updates-*.png` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): portal email updates`

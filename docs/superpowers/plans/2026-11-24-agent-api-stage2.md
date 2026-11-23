# Project 6 Stage 6.2 (Linear's agent API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agents installed as app users receive delegated and @-mentioned work as Linear agent sessions, report progress as agent activities, and people follow and steer them from the issue page.

**Architecture:** Task 1 adds the session and activity model, delegation and the GraphQL operations; Task 2 adds the agent webhooks, prompts from replies, stop and notifications; Task 3 builds the web (delegate field, session view, replies, stop) and runs the end-to-end smoke test with a local fake agent.

**Tech Stack:** Bun, Elysia, Drizzle, graphql-yoga with Linear's SDL, the webhook worker; Next.js 15, React 19, TanStack Query 5, gql.tada; Bun tests (API) and node:test (web).

**Spec:** `docs/superpowers/specs/2026-11-24-oauth-agent-api-design.md` (stage 6.2, "Who can do what", anti-goals). Builds on stage 6.1 (app users, installs, `ctx.auth`, application webhooks).

## Global Constraints

- Linear's SDL is never edited; `gql.tada check` passes. Incremental migrations.
- Delegation: `delegateId` on `issueCreate` / `issueUpdate` / `issueBatchUpdate` accepts only an active app user whose install granted `app:assignable` and who can see the issue's team; the assignee is unchanged.
- A session starts (status `pending`) when an issue is delegated to an app user, when an app user is @-mentioned in a comment (install granted `app:mentionable`), or through `agentSessionCreateOnIssue` / `agentSessionCreateOnComment` called with the app's own token. One open session per (issue or comment thread, app user) — a new trigger on an open session adds a prompt instead (Linear).
- `agentActivityCreate` only by the session's app user. Content types `thought`, `action`, `elicitation`, `response`, `error`; `prompt` is written by people (replies) and by the server (stop). Status: `active` on the first agent activity, `awaitingInput` on `elicitation`, `complete` on `response`, `error` on `error`, back to `active` on a new prompt. Ephemeral activities as Linear defines them.
- Webhooks: `AgentSessionEvent` with `action: created` / `prompted`, Linear's payload shape (session, issue, comment, previous activities, prompt context, guidance as available), to the app's application webhook, signed with its secret; delivered regardless of the app's subscribed resource types (Linear sends agent events to agent apps).
- Stop: a person who can see the issue stops a session from the web; the server writes a `prompt` activity with Linear's `stop` signal and sends `prompted`. Goes through the instance plugin under `/api/auth/*` with the Origin check.
- Seeing sessions and activities: anyone who can see the issue. App tokens see only their own sessions plus what their teams allow.
- Follow AGENTS.md files and `DESIGN.md`. Commit per task, no trailer. Questions settled the way Linear does.

## Review Focus

1. An app user without `app:assignable`, an uninstalled app, a person, or an app that cannot see the team set as delegate is refused with no change. Test in Task 1.
2. App B cannot write activities to, update, or read the activities of app A's session. Test in Task 1.
3. Delegating the same issue twice, or mentioning the app again in the same thread, does not open a second session; it prompts the open one. Test in Task 1 / Task 2.
4. A reply by a person in the session thread reaches the agent exactly once as a `prompted` event, and the agent's own comments do not trigger events. Test in Task 2.
5. Uninstalling an app ends its open sessions (status as Linear's, no further webhooks) and keeps their history readable. Test in Task 2.

---

### Task 1: Sessions, activities, delegation and GraphQL

**Files:** `packages/db` (`agent_session`: id, issue, comment / source comment, app user, creator, status, type, plan, external urls / links, summary, started / ended / dismissed timestamps, timestamps; `agent_activity`: id, session, content type + JSON body per Linear's content types, signal, signal metadata, ephemeral, source comment, user, timestamps), `apps/api/src/agents/` (store and access), GraphQL resolvers: `Issue.delegate` (accept app users), `AgentSession` (fields per the SDL that the model supports), `AgentActivity` and content unions, queries `agentSession`, `agentSessions`, `agentActivity`, `agentActivities`, `Issue`'s session connections if the SDL has them, mutations `agentSessionCreateOnIssue`, `agentSessionCreateOnComment`, `agentActivityCreate`, `agentSessionUpdate`, `agentSessionUpdateExternalUrl`; delegation triggers session creation; mention detection reuses the existing mention parser.

**Interfaces (Produces):** `startSession({ issueId, commentId?, appUserId, creatorId, trigger })`, `addActivity(sessionId, actor, content)`, `sessionStatusAfter(status, contentType)`, events `agentSession.created` / `agentSession.prompted` on the internal event bus for Task 2.

- [ ] **Step 1: Write the failing tests** (`apps/api/src/graphql/__tests__/integration/agent-sessions.test.ts`): delegation rules (Review Focus 1); delegating creates one `pending` session, delegating again prompts it; @-mention of a mentionable app creates a comment session, of a non-mentionable app does not; `agentSessionCreateOnIssue` with the app token; `agentActivityCreate` status transitions for every content type; app B refused on app A's session (Review Focus 2); a person can read sessions on a visible issue, not on a hidden one; `agentSessionUpdate` sets plan / external URLs.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**, migrate. Pure status helper unit-tested.
- [ ] **Step 4: Run** the full API suite — Expected: PASS (object-store tests excepted).
- [ ] **Step 5: Commit** `feat(api): agent sessions, activities and delegation`

### Task 2: Agent webhooks, prompts, stop, notifications

**Files:** webhook event building for `AgentSessionEvent` (Linear's payload), delivery to the app's application webhook regardless of subscribed resource types, replies in a session's comment thread → `prompt` activity + `prompted` event (not for the agent's own comments), stop endpoint in the instance plugin (`POST /api/auth/instance/agent-session-stop { sessionId }`) → `stop` prompt + `prompted`, `AgentSessionNotification` for the session creator when the session needs input or completes, uninstall ends open sessions.

- [ ] **Step 1: Write the failing tests** (`agent-webhooks.test.ts`): delegation sends one `created` event with the issue and the payload fields Linear documents, signed with the app's secret; mention sends `created` with the comment; a person's reply sends exactly one `prompted` with the reply, the agent's comment sends none (Review Focus 4); stop writes a `stop` prompt and sends `prompted`; stop refused cross-origin and for someone who cannot see the issue; notification on `elicitation` and `response`; uninstall ends open sessions, no further events (Review Focus 5).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full API suite — Expected: PASS.
- [ ] **Step 5: Commit** `feat: agent session webhooks, prompts and stop`

### Task 3: Web — delegate field, agent sessions on the issue page

**Files:** Delegate field on the issue page and in the board's property menus / bulk edit (app users with `isAssignable`), session status chip on the issue, session activities in the issue activity feed in Linear's style (thoughts and actions collapsed, elicitations and responses as messages, errors marked, ephemeral shown only while latest), reply in the session thread (comment in the thread → prompt), Stop button (instance plugin), `AgentSessionNotification` in the inbox, refresh of the session view (changed-since rules from 5.1; poll more often while a session is `active` or `pending`).

- [ ] **Step 1: Write the failing tests** for pure helpers (activities → feed entries incl. collapse and ephemeral rule; session status → chip; delegate options).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, root `format:check`, `lint`, `typecheck`, `build`, full API suite; HTTP smoke test against the test DB (API 3100, web 3101; port 3000 taken; magic link from the API log) with a local fake agent (a small Bun HTTP server receiving the app webhook and answering with the app's token): admin creates an app with a webhook URL and installs it with `app:assignable,app:mentionable`; delegate an issue → the fake agent receives `created`, posts `thought`, `action`, `elicitation`; a reply → `prompted` received; the agent posts `response` → status `complete`; mention in a comment → a second session; Stop → `prompted` with `stop`; the issue page and inbox render; uninstall ends the open session. Stop all servers — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): delegate issues to agents and follow their sessions`

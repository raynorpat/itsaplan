# Remove Features Linear Does Not Have Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every feature Linear does not have, in four steps that each leave the app building, tested and usable.

**Architecture:** Pure removal. Each task deletes API folders, routes (and their MCP tools), web pages and navigation, worker jobs, packages, env vars, compose services and tables, unpicks their hooks in remaining code, and adds a migration dropping the tables.

**Tech Stack:** Bun, Elysia, Next.js, Drizzle/Postgres, Turborepo.

**Spec:** `docs/superpowers/specs/2026-11-22-remove-non-linear-features-design.md`

## Global Constraints

- Each task ends with root `format:check`, `lint`, `typecheck`, `build` passing and the API suite passing except object-store tests that need a running store.
- Each task adds one migration via `bun run db:generate` (hand-written DROPs where Drizzle does not know the table, e.g. `mastra_*`); never regenerate the baseline; `bun run db:migrate:test` applies it.
- Keep everything Linear has (issues, states, teams, members, invites, projects, labels, comments, reactions, cycles, initiatives, documents, attachments, notifications, subscriptions, webhooks, views, user preferences, email notification preferences, avatars, API keys), plus MCP and the API docs page.
- `issue.delegate_user_id` stays; setting a delegate to a user is INVALID_INPUT (GraphQL) / 400 (REST); clearing works.
- Bot users are deleted with their agents; comments and activity keep `user_name` / `actor_name` with the user set null.
- Notification email is sent whenever an instance provider is configured; `allowTeams` is removed.
- Notification preferences keep only `email_events`.
- Docs (`AGENTS.md` files, `README.md`, `.env.example`), compose files and Dockerfile `COPY` lines change in the task that removes what they mention.
- Delete tests of removed features; change tests that used them as setup. Commit after each task, no trailer.

## Review Focus

1. A saved view whose filter names an issue type or custom field still loads (the removed keys are ignored). Test in Task 3.
2. A comment written by a deleted bot user loads over GraphQL and REST with its stored author name. Test in Task 4.
3. Setting a delegate to a user is rejected; clearing an existing delegate works. Test in Task 4.
4. Notification email is queued for a member with email events enabled and no team email settings. Test in Task 2.
5. No web page links to a removed page (navigation, settings menu, command palette). Checked by `build` and a grep for the removed routes in Task 1–4 (each task greps `apps/web/src` for its removed paths).

---

### Task 1: Self-contained features

**Files:** delete `apps/api/src/{dashboards,note-boards,analytics,share,webhook-test}/`, `apps/api/src/teams/copy.ts` and its route; `apps/web/src/features/{dashboards,notes}/` and the web pieces of analytics, share and team copy; tables `team_dashboard`, `note_board`, share columns; their entries in `planner.ts`, `app.ts` swagger tags, `apps/web/src/lib/api.ts`, navigation.

- [ ] **Step 1: Write the failing test** `apps/api/src/__tests__/integration/removed-features.test.ts`: `GET /teams/MKT/dashboards`, `/teams/MKT/note-boards`, `/teams/MKT/analytics/...`, the share route and `POST /teams/MKT/copy` (exact paths from the routes being deleted) each answer 404 for the team owner.
- [ ] **Step 2: Run** `cd apps/api && bun test --env-file=../../.env.test src/__tests__/integration/removed-features.test.ts` — Expected: FAIL.
- [ ] **Step 3: Delete**, unpick references, generate the migration, migrate the test DB, grep `apps/web/src` for the removed paths (Expected: no matches).
- [ ] **Step 4: Run** the test and the root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove dashboards, note boards, analytics, share links, webhook test and team copy`

### Task 2: Telegram and team email settings

**Files:** delete `apps/bot/`, `apps/api/src/telegram/`, `apps/api/src/notification-settings/`, Telegram delivery in `apps/api/src/notifications/` and `apps/worker/src/notification-delivery.ts`, `allowTeams` in `packages/auth/src/instance.ts` and god mode (API + web), web Telegram and team-notification settings; tables `user_telegram_account`, `team_notification_setting`, column `user_notification_preference.telegram_events`, the `telegram` channel in `notification_delivery`'s check; compose `bot` services, Dockerfile `COPY apps/bot/package.json` lines, env vars.

- [ ] **Step 1: Write the failing tests:** extend the removed-features test with the Telegram link route and the team notification-settings route → 404; in `apps/api/src/notifications/__tests__/integration/`: `queues email with only the instance provider` — instance email configured (as the existing email tests do), no team settings, member with `email_events.assigned` → assigning queues one `email` delivery.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Delete and rewire** `send.ts` to the instance config; migration; grep web.
- [ ] **Step 4: Run** tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove the Telegram bot and team email settings`

### Task 3: Team actions, issue types, custom fields

**Files:** delete `apps/api/src/{actions,issue-types,custom-fields}/` and their web settings; unpick `issues/store.ts`, `issues/activity.ts`, `issues/routes.ts`, `views/filters.ts`, `attachments/store.ts`, `states/store.ts`, `teams/store.ts` / `routes.ts`, `mcp/instructions.ts`, `graphql/resolvers/reaction.ts`, webhook payloads, web issue detail / create / list; tables `team_action`, `issue_type`, `custom_field`, `custom_field_option`, `issue_field_value`, `issue_field_option`, column `issue.type_id`.

- [ ] **Step 1: Write the failing tests:** removed-features test gets the actions, issue-types and custom-fields routes → 404; `apps/api/src/views/__tests__/integration/`: `loads a view whose filter names removed fields` — a view saved with `{ typeIds: [...], fields: {...} }` in its filters is listed and applying it returns the team's issues.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Delete and unpick**; migration; grep web.
- [ ] **Step 4: Run** tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove team actions, issue types and custom fields`

### Task 4: Built-in AI agents

**Files:** delete `apps/api/src/{ai-agents,agent-skills,agent-tools,agent-schedules,integrations}/`, `packages/agent-tools/`, `@mastra/*` deps, worker `agent-runs.ts` / `agent-worker.ts` / `schedules.ts` and their wiring, `/internal/agent-*` routes, web `ai-chat` and agent settings; move `parseMentions` / `parseMentionedUsers` to `apps/api/src/shared/mentions.ts`; unpick `comments/store.ts`, `issues/store.ts`, `issues/activity.ts`, `members/store.ts`, `god/store.ts`, `notifications/store.ts`, `graphql/resolvers/team.ts` (`visibleUsers` without agents), `settings/updates.ts`, `app.ts`, `planner.ts`; tables `ai_agent`, `agent_run`, `agent_schedule`, `agent_skill`, `agent_skill_link`, `agent_tool`, `agent_tool_link`, `integration_credential`, `mastra_*` (hand-written `DROP TABLE IF EXISTS`); the migration deletes bot users (`DELETE FROM "user" WHERE id IN (SELECT user_id FROM ai_agent)`) before dropping `ai_agent`; Dockerfile `COPY packages/agent-tools/package.json` lines, env vars.

- [ ] **Step 1: Write the failing tests:** removed-features test gets the ai-agents, agent-skills, agent-tools, agent-schedules and integrations routes → 404; GraphQL `issueUpdate(input: { delegateId: <member id> })` → INVALID_INPUT and `delegateId: null` → success; `keeps a comment whose author was deleted` — a member comments, the user row is deleted, `comment(id)` over GraphQL returns `user: null` and the REST feed shows the stored name.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Delete and unpick**; migration; grep web; `bun install` to update the lockfile.
- [ ] **Step 4: Run** tests and root checks — Expected: PASS.
- [ ] **Step 5: Commit** `feat!: remove the built-in AI agents`

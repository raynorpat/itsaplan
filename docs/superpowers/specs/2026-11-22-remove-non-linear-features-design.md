# Remove features Linear does not have

Project 1 of the move to a Linear-only app with one API (`/graphql`). Follows the
Linear GraphQL stages 1–9.

## Intent

The app becomes Linear, served by one GraphQL API. Features Linear does not have are
removed first, so the later projects (Linear's roles, organization settings, the
web app on GraphQL, OAuth and Linear's agent API, deleting REST) have less to port.
Nothing has been released, so no data is kept and no transition is offered.

The later projects, in order: 2 Linear's roles; 3 god mode to `Organization`
settings and environment variables; 4 GraphQL gaps the web app needs; 5 the web app
on GraphQL; 6 OAuth, then Linear's agent API; 7 MCP tools and tests on GraphQL, then
REST deleted.

## Goals

Remove, with their API folders, routes, MCP tools, web pages and navigation, worker
jobs, packages, environment variables, compose services and database tables:

- **Step 1, self-contained:** dashboards (`team_dashboard`), note boards
  (`note_board`), analytics, share links (`share/`), the webhook test ping
  (`webhook-test/`), team copy (`teams/copy.ts` and its route).
- **Step 2, Telegram and team email settings:** `apps/bot`, the Telegram routes and
  account linking (`telegram/`, `user_telegram_account`), the Telegram notification
  channel (`user_notification_preference.telegram_events`, the `telegram` channel of
  `notification_delivery` and its worker delivery), team notification settings
  (`notification-settings/`, `team_notification_setting`). Email is sent with the
  instance email settings only.
- **Step 3, wired into issues:** team actions (`actions/`, `team_action`), issue
  types (`issue-types/`, `issue_type`, `issue.type_id`), custom fields
  (`custom-fields/`, `custom_field`, `custom_field_option`, `issue_field_value`,
  `issue_field_option`), and their hooks in issue create and update, issue activity,
  view filters, attachments (embed stripping from field values), state archiving,
  team create (seeded types or fields), the MCP instructions and webhook payloads.
- **Step 4, the built-in AI agents:** `ai-agents/` (runtime, run queue, issue
  query, mentions), `agent-skills/`, `agent-tools/`, `agent-schedules/`,
  `integrations/` (the agents' model and tool credentials), the tables `ai_agent`,
  `agent_run`, `agent_schedule`, `agent_skill`, `agent_skill_link`, `agent_tool`,
  `agent_tool_link`, `integration_credential`, Mastra (`@mastra/*` and its
  `mastra_*` tables), `@repo/agent-tools`, the worker's agent-run and schedule jobs
  (`agent-runs.ts`, `agent-worker.ts`, `schedules.ts`, the `/internal/agent-*`
  routes), and the web's AI chat and agent settings. Their hooks in issue
  create/update/delete (delegate runs, assign triggers, thread deletion), comments
  (mention runs), members, users visible through agents, notifications, god mode,
  analytics and update checks.

## Non-goals

- Linear's roles, organization settings, OAuth, Linear's agent API, the web app on
  GraphQL, deleting REST, MCP or the API docs page: later projects.
- Replacements for removed features (Linear's `WorkflowDefinition`, Linear's
  agents): later.
- Keeping or converting removed data.

## Anti-goals

- A step that leaves the app failing to build, the tests failing (other than the
  object-store tests that need a running store), or a web page that errors or links
  to a removed page.
- Removing something Linear has: issues, states, teams, members, invites, projects,
  labels, comments, reactions, cycles, initiatives, documents, attachments,
  notifications, subscriptions, webhooks, views, user preferences, email
  notification preferences, avatars, API keys.
- A comment or history entry that fails to load because its author was an agent's
  bot user.

## Approaches

1. **Delete outright, in four steps grouped by dependency (chosen).** Each step
   leaves everything building and passing; the riskiest removal (agents) is last and
   separate.
2. **Hide behind a switch first, delete later.** Rejected: there are no users to
   move over.
3. **One deletion commit.** Rejected: hard to review, and a mistake is hard to
   locate.

## Decisions

- **Migrations:** each step adds a new migration (`bun run db:generate`) dropping its
  tables and columns. The baseline is not regenerated (`0001` from other work sits
  on it).
- **Bot users are deleted** with their agents (step 4 migration: the `user` rows
  of `ai_agent.user_id`, which cascades to their team memberships, API keys and
  sessions). Comments and history they wrote stay, with the author set null and the
  stored author name (`comment.user_name`, `issue_activity.actor_name`) kept, as for
  any deleted user. Issues delegated to them have `delegate_user_id` cleared by the
  user FK. Nothing has been released, so no agent data is kept (builder's call).
- **`issue.delegate_user_id` stays** for Linear's agent API (project 6). Until then
  no user can be a delegate: setting `delegateId` (GraphQL) or `delegateUserId`
  (REST) to a user is INVALID_INPUT / 400; clearing it works.
- **Mentions:** `parseMentions` and `parseMentionedUsers` move from
  `ai-agents/mentions.ts` to a shared module; notifications keep using them.
- **Email:** notification email uses the instance email settings (god mode) only and
  is sent whenever an instance provider is configured. The `allowTeams` instance
  setting (whether teams may use the instance provider), its DTO field and its god
  mode control are removed in step 2 (builder's call).
- **Notification preferences** keep only email events (`email_events`).
- **Tests** of removed features are deleted; tests that used them as setup are
  changed to not need them.
- **Docs:** root and package `AGENTS.md`, `README.md`, `.env.example`, compose files
  and Dockerfiles (`COPY` lines for `apps/bot` and `packages/agent-tools`) are
  updated in the step that removes the thing they mention.

## Left to the builder

The exact list of files per step (found by following imports), how each hook is
unpicked, and the order inside a step.

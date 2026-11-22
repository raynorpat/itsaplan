// Task planner tables: teams, workflow columns, issue types, labels, custom
// fields, issues, and their dependent rows. Exposed to the web app over HTTP by
// the API.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

// Global key-value settings for the instance, not scoped to a team. The value is
// a jsonb blob owned by whatever feature reads the key, so one table backs many
// settings.
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Instance-wide secrets, the encrypted counterpart of app_setting. One row per key
// (e.g. 'auth.email' for the instance mail provider); the value is a JSON blob
// encrypted as a whole, so a key can hold several credentials. `redacted` mirrors the
// same blob with every secret replaced by a boolean, for the settings UI to read
// without decrypting. Encryption is AES-256-GCM with APP_ENCRYPTION_KEY — changing
// that env value makes stored rows undecryptable.
export const appSecret = pgTable('app_secret', {
  key: text('key').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  redacted: jsonb('redacted').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A team groups its own columns, issue types, labels, custom fields, and
// issues. next_sequence is the atomic counter behind each issue's human
// identifier (e.g. "MKT-42"): incrementing it under a row lock keeps concurrent
// creates from colliding.
export const team = pgTable('team', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  nextSequence: integer('next_sequence').notNull().default(1),
  // Whether this team is reachable through the MCP server. Off by default: an
  // owner opts a team in before agents can work with it over MCP.
  mcpEnabled: boolean('mcp_enabled').notNull().default(false),
  // Optional sections of the app, toggled per team in Settings -> Features. All
  // on by default. Turning one off only hides its UI; the rows it owns stay and
  // come back with it.
  projectsEnabled: boolean('projects_enabled').notNull().default(true),
  dashboardsEnabled: boolean('dashboards_enabled').notNull().default(true),
  notesEnabled: boolean('notes_enabled').notNull().default(true),
  // Cycles (Linear's team cycle settings). Weeks for duration and cooldown;
  // cycle_start_day is 0 = Sunday … 6 = Saturday. next_cycle_number issues cycle
  // numbers under a row lock, like next_sequence for issues.
  cyclesEnabled: boolean('cycles_enabled').notNull().default(false),
  cycleDuration: integer('cycle_duration').notNull().default(2),
  cycleStartDay: integer('cycle_start_day').notNull().default(1),
  cycleCooldownTime: integer('cycle_cooldown_time').notNull().default(0),
  upcomingCycleCount: integer('upcoming_cycle_count').notNull().default(2),
  cycleIssueAutoAssignStarted: boolean('cycle_issue_auto_assign_started').notNull().default(false),
  cycleIssueAutoAssignCompleted: boolean('cycle_issue_auto_assign_completed')
    .notNull()
    .default(false),
  nextCycleNumber: integer('next_cycle_number').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Per-team key-value settings, mirroring app_setting but scoped to a team.
// The value is a jsonb blob owned by whatever feature reads the key, so one table
// backs many team settings (e.g. auto-archive thresholds under key
// 'auto_archive'). Composite PK (team_id, key).
export const teamSetting = pgTable(
  'team_setting',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.key] })],
);

// A user's own interface preferences, held per account rather than per team so
// the same choices apply on every device. timezone is an IANA zone name used by the
// web app to render stored UTC timestamps; the API keeps storing and returning UTC.
// theme is 'light' | 'dark' | 'system', issue_open_mode is 'panel' | 'page' (how a
// clicked issue opens), start_page is the section the app root lands on. Absent row
// means the user has not changed anything and the defaults below apply.
// last_team_id is the team the user was in last, so the app root reopens it
// after signing in on any device; the FK clears it when that team is deleted.
// show_chat_by_default keeps the floating AI chat button on screen from the start,
// with the chat window collapsed. hotkeys holds the keyboard shortcuts this user
// rebound. issue_stats_open and issue_stats_view are how the status stats section of
// an issue starts out: expanded or collapsed, and 'compact' (one bar per status) or
// 'timeline' (a lane per status on a time axis). Switching it on an issue is not
// stored — it lasts as long as that issue stays open.
export const userPreference = pgTable(
  'user_preference',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    timezone: text('timezone').notNull().default('UTC'),
    theme: text('theme').notNull().default('system'),
    issueOpenMode: text('issue_open_mode').notNull().default('panel'),
    startPage: text('start_page').notNull().default('work-items'),
    showChatByDefault: boolean('show_chat_by_default').notNull().default(false),
    issueStatsOpen: boolean('issue_stats_open').notNull().default(true),
    issueStatsView: text('issue_stats_view').notNull().default('compact'),
    // The user's own keyboard shortcut overrides, as { hotkeyId: combo }. Only the
    // bindings they changed are stored; the rest come from the instance defaults
    // (app_setting key 'hotkeys') and then the built-in ones.
    hotkeys: jsonb('hotkeys').$type<Record<string, string>>(),
    lastTeamId: uuid('last_team_id').references(() => team.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('user_preference_theme_check', sql`${t.theme} IN ('light', 'dark', 'system')`),
    check('user_preference_issue_open_mode_check', sql`${t.issueOpenMode} IN ('panel', 'page')`),
    check(
      'user_preference_start_page_check',
      sql`${t.startPage} IN ('inbox', 'dashboard', 'work-items', 'projects', 'ai-chat')`,
    ),
    check(
      'user_preference_issue_stats_view_check',
      sql`${t.issueStatsView} IN ('compact', 'timeline')`,
    ),
  ],
);

// Custom roles per team. A role carries a permission matrix: for each
// resource (work_items, dashboards, ...) the create/edit/read/delete flags. The
// matrix is a jsonb blob owned and enforced by the API (see
// apps/api/src/shared/permissions.ts). Exactly one role per team is the
// default ("Member"): it is assigned to members that join through an invite and
// is the fallback for a member row with no explicit role. Owners bypass roles
// entirely (they always have full access), so their team_member.role_id stays
// NULL.
export const teamRole = pgTable(
  'team_role',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    permissions: jsonb('permissions').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    // At most one default role per team.
    uniqueIndex('team_role_default_uq')
      .on(t.teamId)
      .where(sql`${t.isDefault}`),
    index('team_role_team_idx').on(t.teamId),
  ],
);

// Team membership: which users can access a team and their role in it.
// A user reaches a team's columns, issues, labels, and every other
// team-scoped entity only through a row here. The creator is inserted as
// "owner"; a team can have several owners. Owners always have full access and
// manage the member list. A "member" row carries role_id pointing at a
// team_role whose permission matrix decides what that member may do; a NULL
// role_id falls back to the team's default role. Access checks resolve the
// owning team of any entity and look for the current user here.
export const teamMember = pgTable(
  'team_member',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    roleId: uuid('role_id').references(() => teamRole.id, {
      onDelete: 'set null',
    }),
    // What this member does in the team. Free text set by an owner, shown on the
    // members page and given to agents so they can pick who to tag on an unassigned
    // issue. Empty string when unset.
    description: text('description').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    check('team_member_role_check', sql`${t.role} IN ('owner', 'member')`),
    index('team_member_user_idx').on(t.userId),
  ],
);

// Team invites: a shareable link (token) that grants a specific email a
// specific role in a team once accepted. The role is the owner/member flag
// plus, for a member, role_id naming which custom role they join on. An owner
// creates an invite; the
// invited person opens the link and accepts (only if their session email matches
// invite.email) or rejects it. Accepting creates the team_member row. At most
// one pending invite per (team, email) — enforced by the partial unique index.
// email is stored lowercased. Revoking a pending invite removes its row.
export const teamInvite = pgTable(
  'team_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: uuid('token').notNull().defaultRandom().unique(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull().default('member'),
    // The custom role the invitee joins on when role is "member". NULL falls back
    // to the team's default role. Owners bypass roles, so an owner invite keeps
    // this NULL.
    roleId: uuid('role_id').references(() => teamRole.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('pending'),
    invitedByUserId: uuid('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    check('team_invite_role_check', sql`${t.role} IN ('owner', 'member')`),
    check('team_invite_status_check', sql`${t.status} IN ('pending', 'accepted', 'rejected')`),
    // At most one pending invite per team + email.
    uniqueIndex('team_invite_pending_uq')
      .on(t.teamId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('team_invite_team_idx').on(t.teamId),
  ],
);

export const workflowState = pgTable(
  'workflow_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    stateType: text('state_type').notNull().default('unstarted'),
    color: text('color').notNull().default('#6b7280'),
    description: text('description').notNull().default(''),
    position: integer('position').notNull(),
    // When set, the column is archived: hidden from the board, REST and MCP, and
    // refused as an issue target. Archived columns keep their position value, so
    // position is unique only among active columns.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'workflow_state_state_type_check',
      sql`${t.stateType} IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')`,
    ),
    uniqueIndex('workflow_state_active_position_idx')
      .on(t.teamId, t.position)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const issueType = pgTable(
  'issue_type',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default(''),
    color: text('color').notNull().default('#6b7280'),
    isDefault: boolean('is_default').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.teamId, t.name)],
);

export const label = pgTable(
  'label',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Null for a workspace label, usable on every team's issues.
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'cascade' }),
    // The group (an is_group label of the same scope) this label belongs to.
    parentId: uuid('parent_id').references((): AnyPgColumn => label.id, { onDelete: 'set null' }),
    isGroup: boolean('is_group').notNull().default(false),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').notNull().default('#6b7280'),
    // A retired label stays on the issues that have it but cannot be newly applied.
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Names are unique per team, and among workspace labels (team_id null).
  (t) => [unique().on(t.teamId, t.name).nullsNotDistinct()],
);

// AI agents attached to a team. Each agent is backed by a hidden bot user
// (user_id -> user.id): that user is what a work item is delegated to, what a
// comment/activity is authored by, and what owns the agent's API key (better-auth
// apikey.reference_id points at it). An external agent needs only a name (on the
// bot user) + username and a key; an internal agent additionally carries a model
// configuration (provider/model/instructions/tools) used to run it. What an agent
// may do is governed by the tools it is granted, not by a team role — an agent
// is not a team_member.
export const aiAgent = pgTable(
  'ai_agent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    kind: text('kind').notNull(),
    // Internal-agent model configuration. NULL/empty for an external agent.
    // model_credential_id references the integration_credential (kind 'llm') the
    // runtime decrypts to address the model; model names the model id on it.
    modelCredentialId: uuid('model_credential_id').references(() => integrationCredential.id, {
      onDelete: 'set null',
    }),
    model: text('model'),
    instructions: text('instructions'),
    // Enabled capability-tool keys (from the code tool registry). System tools
    // that act on the API with the agent's own token are implicit and not listed.
    tools: jsonb('tools').notNull().default([]),
    temperature: doublePrecision('temperature'),
    maxSteps: integer('max_steps'),
    // Internal-agent run triggers. A mention in a comment enqueues a run when
    // trigger_on_mention is set; being set as an issue's delegate enqueues one when
    // trigger_on_assign is set.
    triggerOnMention: boolean('trigger_on_mention').notNull().default(true),
    triggerOnAssign: boolean('trigger_on_assign').notNull().default(false),
    // Authorization: the team_role the bot user acts under. Every agent request
    // carries its API key and is enforced by this role through the normal permission
    // checks — an external agent's HTTP calls and an internal agent's in-process tool
    // dispatch alike. NULL means the bot user has no membership yet and cannot act.
    roleId: uuid('role_id').references(() => teamRole.id, { onDelete: 'set null' }),
    // The agent's own API key, encrypted at rest (AES-256-GCM, see shared/crypto).
    // An internal agent replays it on every tool call, so unlike better-auth's
    // hashed apikey row it has to stay recoverable. Set for internal agents only:
    // an external agent's key is held by whoever drives it and is never stored here.
    apiKeyCiphertext: text('api_key_ciphertext'),
    apiKeyIv: text('api_key_iv'),
    apiKeyAuthTag: text('api_key_auth_tag'),
    // Conversation memory: when enabled, the agent recalls the last
    // memory_last_messages messages of a thread (persisted by Mastra's Postgres
    // store). memory_last_messages is NULL when memory is off.
    memoryEnabled: boolean('memory_enabled').notNull().default(false),
    memoryLastMessages: integer('memory_last_messages'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.username),
    unique().on(t.userId),
    check('ai_agent_kind_check', sql`${t.kind} IN ('external', 'internal')`),
    index('ai_agent_team_idx').on(t.teamId),
  ],
);

// Recurring autonomous tasks for internal agents. The worker claims rows whose
// next_run_at is due, advances the cadence, and inserts an agent_run snapshot.
export const agentSchedule = pgTable(
  'agent_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull(),
    status: text('status').notNull().default('active'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_schedule_status_check', sql`${t.status} IN ('active', 'paused')`),
    unique().on(t.agentId, t.name),
    index('agent_schedule_due_idx').on(t.status, t.nextRunAt),
    index('agent_schedule_agent_idx').on(t.agentId),
  ],
);

// Queued autonomous runs of an internal agent. Mentions and delegations carry an
// issue; scheduled and manual runs do not. The worker claims due rows with a lease,
// runs the agent, and records the result for history and retries.
export const agentRun = pgTable(
  'agent_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').references(() => agentSchedule.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull().default('delegation'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    // The comment that mentioned the agent, kept for traceability. The prompt is
    // snapshotted into `prompt` so a run still works if the comment is later deleted.
    sourceCommentId: uuid('source_comment_id').references((): AnyPgColumn => comment.id, {
      onDelete: 'set null',
    }),
    // The mention comment body at enqueue time, framed into the agent's prompt.
    prompt: text('prompt').notNull(),
    // pending -> success | failed. Like webhook_delivery, a claim keeps the row
    // 'pending' and pushes next_attempt_at forward by a lease, so a run whose poller
    // crashes mid-flight becomes claimable again after the lease expires.
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    output: text('output'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agent_run_status_check', sql`${t.status} IN ('pending', 'success', 'failed')`),
    check(
      'agent_run_trigger_check',
      sql`${t.trigger} IN ('mention', 'delegation', 'schedule', 'manual')`,
    ),
    uniqueIndex('agent_run_schedule_fire_uq').on(t.scheduleId, t.scheduledFor),
    index('agent_run_due_idx').on(t.status, t.nextAttemptAt),
    index('agent_run_schedule_idx').on(t.scheduleId),
    index('agent_run_source_comment_idx').on(t.sourceCommentId),
  ],
);

// Stored credentials for a team's integrations. One store for every secret: the
// API keys of LLM providers (kind 'llm', addressed by an internal agent's model) and
// the credentials of tool integrations (kind 'tool', bound to configured tools).
// integration_key names the integration in the catalog; the credential's fields (and
// which are secret) come from that integration's credentialSchema. The full
// credential object is stored encrypted (AES-256-GCM, see
// apps/api/src/shared/crypto.ts): ciphertext + iv + auth_tag. `redacted` is the same
// object with secret fields masked, kept in plaintext for a masked display. The
// secret is never returned to the client. A team may hold several credentials per
// integration (e.g. two Jina keys), told apart by `label`.
export const integrationCredential = pgTable(
  'integration_credential',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    integrationKey: text('integration_key').notNull(),
    label: text('label'),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    // The credential with secret fields masked; non-secret fields verbatim. Owned by
    // the store, derived from the integration's credential schema.
    redacted: jsonb('redacted').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('integration_credential_team_idx').on(t.teamId)],
);

// Per-team notification provider credentials: the outbound channels the team
// can deliver through (SMTP or Resend for email, a Telegram bot). One row per
// team, managed by an owner. The config carries secrets (SMTP password, Resend
// API key, Telegram bot token), so it is stored encrypted (AES-256-GCM, see
// apps/api/src/shared/crypto.ts): ciphertext + iv + auth_tag. `redacted` is the
// same config with secret values dropped, kept in plaintext so the settings UI can
// render the non-secret fields and show which secrets are set. Secrets are never
// returned to the client. The plaintext config is read only by the delivery sender.
// Which events reach a given member is a per-user choice held in
// user_notification_preference, not here. The Telegram bot token here is optional: a
// team that sets one delivers through its own bot, otherwise delivery falls back
// to the instance bot in app_secret key 'telegram.bot'.
export const teamNotificationSetting = pgTable('team_notification_setting', {
  teamId: uuid('team_id')
    .primaryKey()
    .references(() => team.id, { onDelete: 'cascade' }),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  redacted: jsonb('redacted').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A member's own notification preferences for one team: for each issue event
// type, whether they want it by email and/or Telegram. One row per (user, team);
// absent means the member has not opted in and receives nothing.
// email_events/telegram_events are EventToggles jsonb keyed by the four inbox
// notification types (assigned/mentioned/commented/state_changed). Email is sent to
// the member's account address; Telegram to the chat of the account they linked in
// user_telegram_account, which is instance-wide rather than per team.
export const userNotificationPreference = pgTable(
  'user_notification_preference',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    emailEvents: jsonb('email_events').notNull().default({}),
    telegramEvents: jsonb('telegram_events').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('user_notification_pref_user_team_unique').on(t.userId, t.teamId)],
);

// The Telegram account a user has linked, instance-wide (one row per user, whatever
// the team). Linking runs through the instance bot: the user asks for a link, the
// row is created with a one-time link_code, and the bot fills chat_id when that code
// arrives as `/start <code>`. So the row is "pending" while chat_id is null and
// "linked" once it is set — link_code is cleared at that point. chat_id is unique, so
// one Telegram account cannot serve two product accounts.
export const userTelegramAccount = pgTable(
  'user_telegram_account',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    chatId: text('chat_id'),
    // Display only, refreshed on every link: what to show the user so they can tell
    // which Telegram account this is. A Telegram account may have no @username.
    username: text('username'),
    firstName: text('first_name'),
    linkCode: text('link_code'),
    linkCodeExpiresAt: timestamp('link_code_expires_at', { withTimezone: true }),
    linkedAt: timestamp('linked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_telegram_account_chat_id_unique')
      .on(t.chatId)
      .where(sql`${t.chatId} IS NOT NULL`),
    uniqueIndex('user_telegram_account_link_code_unique')
      .on(t.linkCode)
      .where(sql`${t.linkCode} IS NOT NULL`),
  ],
);

// Outbox for outbound notification delivery. One row per (recipient, channel,
// message) to send for an issue event: an email or a Telegram message to one member.
// Rows are enqueued when inbox notifications are created (see
// apps/api/src/notifications/outbound.ts) and drained by the worker following the
// same claim/retry pattern as webhook_delivery. The message text is composed at
// enqueue time and stored in `payload`; the channel credentials are read from
// team_notification_setting at send time. channel is 'email' | 'telegram'
// ('email' picks SMTP or Resend from the team config). recipient is the member's
// email address for email rows, or their Telegram chat id for telegram rows.
export const notificationDelivery = pgTable(
  'notification_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    channel: text('channel').notNull(),
    recipient: text('recipient'),
    // Composed message: { subject?, text, html?, url? }. Owned by the sender.
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('notification_delivery_channel_check', sql`${t.channel} IN ('email', 'telegram')`),
    // Backs the worker's claim query: due pending rows ordered by next_attempt_at.
    index('notification_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// Skill library for a team. A skill is a unit of knowledge given to an internal
// agent (Anthropic Agent Skill format): a SKILL.md with YAML frontmatter
// (name/description) plus optional reference files, no executable scripts. The
// markdown and reference bytes live in the S3 object store under s3_prefix; `files`
// lists the reference file paths and their object keys. Sourced from an upload,
// inline text, or a GitHub URL. Enabled on an agent via agent_skill_link.
export const agentSkill = pgTable(
  'agent_skill',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    source: text('source').notNull(),
    sourceUrl: text('source_url'),
    // Object-store prefix holding SKILL.md and reference files for this skill.
    s3Prefix: text('s3_prefix').notNull(),
    // Reference files beyond SKILL.md: [{ path, s3Key, size }]. Owned by the store.
    files: jsonb('files').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.name),
    check('agent_skill_source_check', sql`${t.source} IN ('upload', 'inline', 'github')`),
    index('agent_skill_team_idx').on(t.teamId),
  ],
);

// Which skills are enabled on which agents (many-to-many). Deleting an agent or a
// skill removes the link.
export const agentSkillLink = pgTable(
  'agent_skill_link',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id')
      .notNull()
      .references(() => agentSkill.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('agent_skill_link_skill_idx').on(t.skillId),
  ],
);

// A custom tool configured in a team: a tool from the catalog (tool_key) bound to
// one integration_credential. The tool's integration owns the secret, so the tool
// holds no secret of its own — it references the credential the runtime decrypts at
// call time. Different tools of the same integration may be bound to different
// credentials (e.g. two Jina keys). Enabled on an agent via agent_tool_link.
export const agentTool = pgTable(
  'agent_tool',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    toolKey: text('tool_key').notNull(),
    credentialId: uuid('credential_id')
      .notNull()
      .references(() => integrationCredential.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.toolKey, t.credentialId),
    index('agent_tool_team_idx').on(t.teamId),
    index('agent_tool_credential_idx').on(t.credentialId),
  ],
);

// Which configured tools are enabled on which agents (many-to-many). Deleting an
// agent or a configured tool removes the link.
export const agentToolLink = pgTable(
  'agent_tool_link',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => aiAgent.id, { onDelete: 'cascade' }),
    agentToolId: uuid('agent_tool_id')
      .notNull()
      .references(() => agentTool.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.agentToolId] }),
    index('agent_tool_link_tool_idx').on(t.agentToolId),
  ],
);

// Custom fields. Always scoped to a team. A NULL issue_type_id applies the
// field to every issue in that team; a non-null issue_type_id scopes it to
// that one type.
export const customField = pgTable(
  'custom_field',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    issueTypeId: uuid('issue_type_id').references(() => issueType.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    fieldType: text('field_type').notNull(),
    // When true the field renders in the issue body (under the description),
    // like a second description; when false it renders as a Properties row.
    showInBody: boolean('show_in_body').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'custom_field_field_type_check',
      sql`${t.fieldType} IN ('text', 'markdown', 'url', 'number', 'boolean', 'date', 'select', 'multi_select')`,
    ),
  ],
);

export const customFieldOption = pgTable(
  'custom_field_option',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    color: text('color').notNull().default('#6b7280'),
    position: integer('position').notNull().default(0),
  },
  (t) => [unique().on(t.fieldId, t.value)],
);

// Linear's project statuses. A fixed set of six rows (one per type) is seeded by the
// baseline migration with the ids in project-statuses.ts; status CRUD is not
// offered yet.
export const projectStatus = pgTable(
  'project_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    color: text('color').notNull(),
    description: text('description'),
    position: doublePrecision('position').notNull().default(0),
    // Whether projects are expected to stay in this status without an end date.
    indefinite: boolean('indefinite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'project_status_type_check',
      sql`${t.type} IN ('backlog', 'planned', 'started', 'paused', 'completed', 'canceled')`,
    ),
  ],
);

// A Linear project: a body of work across one or more teams (project_team). Issues
// point at it through issue.project_id and must belong to one of its teams.
// description is a short plain-text summary; content is the Markdown overview.
// Health is the latest project update's health (project_update).
export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    content: text('content').notNull().default(''),
    color: text('color'),
    icon: text('icon'),
    statusId: uuid('status_id')
      .notNull()
      .references(() => projectStatus.id),
    leadUserId: uuid('lead_user_id').references(() => user.id, { onDelete: 'set null' }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    // Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    priority: integer('priority').notNull().default(0),
    startDate: date('start_date'),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    // Linear's short project id (12 lowercase hex chars), usable in place of the id.
    slugId: text('slug_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(gen_random_uuid()::text), 1, 12)`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('project_priority_check', sql`${t.priority} BETWEEN 0 AND 4`)],
);

// The teams a project belongs to. A project keeps at least one (enforced by the
// store); deleting a team removes its links.
export const projectTeam = pgTable(
  'project_team',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.teamId] }),
    index('project_team_team_idx').on(t.teamId),
  ],
);

export const projectMilestone = pgTable(
  'project_milestone',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    targetDate: date('target_date'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('project_milestone_project_idx').on(t.projectId, t.sortOrder)],
);

// A project update: a status post with a health reading. The newest one gives the
// project its health.
export const projectUpdate = pgTable(
  'project_update',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    health: text('health').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('project_update_health_check', sql`${t.health} IN ('onTrack', 'atRisk', 'offTrack')`),
    index('project_update_project_idx').on(t.projectId, t.createdAt.desc()),
  ],
);

// Workspace-level project labels (Linear's ProjectLabel), separate from issue
// labels. A label with is_group holds child labels and cannot be applied itself.
export const projectLabel = pgTable(
  'project_label',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    color: text('color').notNull().default('#4EA7FC'),
    description: text('description'),
    parentId: uuid('parent_id').references((): AnyPgColumn => projectLabel.id, {
      onDelete: 'cascade',
    }),
    isGroup: boolean('is_group').notNull().default(false),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Names are unique among siblings; NULLS NOT DISTINCT so top-level names clash too.
    unique('project_label_sibling_name_unique').on(t.parentId, t.name).nullsNotDistinct(),
  ],
);

export const projectLabelLink = pgTable(
  'project_label_link',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => projectLabel.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.labelId] })],
);

// A team's cycle (Linear's Cycle): a time box from starts_at to ends_at, numbered
// in order within the team. completed_at is set when the cycle closes (on schedule
// or by hand). The *_history arrays hold one value per day since the cycle
// started, appended by the cycle upkeep; uncompleted_issue_ids_upon_close is the
// snapshot of unfinished issues moved on when it closed.
export const cycle = pgTable(
  'cycle',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name'),
    description: text('description'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    issueCountHistory: integer('issue_count_history')
      .array()
      .notNull()
      .default(sql`'{}'`),
    completedIssueCountHistory: integer('completed_issue_count_history')
      .array()
      .notNull()
      .default(sql`'{}'`),
    scopeHistory: real('scope_history')
      .array()
      .notNull()
      .default(sql`'{}'`),
    completedScopeHistory: real('completed_scope_history')
      .array()
      .notNull()
      .default(sql`'{}'`),
    inProgressScopeHistory: real('in_progress_scope_history')
      .array()
      .notNull()
      .default(sql`'{}'`),
    uncompletedIssueIdsUponClose: uuid('uncompleted_issue_ids_upon_close')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.number),
    check('cycle_dates_check', sql`${t.endsAt} > ${t.startsAt}`),
    index('cycle_team_starts_idx').on(t.teamId, t.startsAt),
  ],
);

export const issue = pgTable(
  'issue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    sequenceNumber: integer('sequence_number').notNull(),
    typeId: uuid('type_id').references(() => issueType.id, {
      onDelete: 'set null',
    }),
    // The project this issue belongs to; it must include the issue's team (enforced
    // by the store). Deleting the project unlinks its issues rather than deleting them.
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'set null',
    }),
    // The project milestone the issue belongs to; it must be a milestone of the
    // issue's project (enforced by the store).
    projectMilestoneId: uuid('project_milestone_id').references(() => projectMilestone.id, {
      onDelete: 'set null',
    }),
    // The team cycle the issue belongs to (a cycle of the issue's own team).
    cycleId: uuid('cycle_id').references(() => cycle.id, { onDelete: 'set null' }),
    stateId: uuid('state_id')
      .notNull()
      .references(() => workflowState.id),
    assigneeUserId: uuid('assignee_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    // The AI agent an issue is delegated to. Like assignee this points at a bot
    // user (ai_agent.user_id); assignee holds a team member, delegate holds an
    // agent. Setting a delegate on an internal agent with trigger_on_assign enqueues
    // an agent run.
    delegateUserId: uuid('delegate_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    // Parent issue (sub-issues). Same team, enforced by the store; deleting the
    // parent leaves its children as top-level issues.
    parentId: uuid('parent_id').references((): AnyPgColumn => issue.id, {
      onDelete: 'set null',
    }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    priority: integer('priority').notNull().default(0),
    estimate: real('estimate'),
    startDate: date('start_date'),
    dueDate: date('due_date'),
    position: doublePrecision('position').notNull().default(0),
    // Set when the issue first enters a started column; cleared when it moves back
    // to a backlog or unstarted column.
    startedAt: timestamp('started_at', { withTimezone: true }),
    // Set when the issue enters a completed column; cleared when it leaves one.
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Set when the issue enters a canceled column; cleared when it leaves one.
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    // When set, the issue is archived: hidden from the board and lists but kept and
    // restorable. Set manually (archive action) or by the worker's auto-archive
    // sweep for issues that sat in a completed/canceled column past the team's
    // configured threshold. NULL means active (on the board).
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Unguessable token for the public read-only share link. NULL means the issue
    // is not shared; setting it enables the link, clearing it revokes access.
    shareToken: uuid('share_token').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.teamId, t.sequenceNumber),
    check('issue_priority_check', sql`${t.priority} BETWEEN 0 AND 4`),
    // Backs the board/list read (active issues of a team) and the worker's
    // auto-archive sweep (still-active issues in a team).
    index('issue_team_active_idx')
      .on(t.teamId, t.stateId)
      .where(sql`${t.archivedAt} IS NULL`),
    index('issue_cycle_idx').on(t.cycleId),
  ],
);

export const issueLabel = pgTable(
  'issue_label',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => label.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.labelId] })],
);

export const issueFieldValue = pgTable(
  'issue_field_value',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    valueText: text('value_text'),
    valueNumber: numeric('value_number'),
    valueBool: boolean('value_bool'),
    valueDate: date('value_date'),
  },
  (t) => [unique().on(t.issueId, t.fieldId)],
);

export const issueFieldOption = pgTable(
  'issue_field_option',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => customField.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => customFieldOption.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.fieldId, t.optionId] })],
);

// File attachments on issues. Bytes live in the S3-compatible object store;
// this table holds metadata and the object key. public_id is the unguessable id
// used in the public download URL.
export const issueAttachment = pgTable(
  'issue_attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('issue_attachment_issue_idx').on(t.issueId)],
);

// Change log of issues and projects. Each row belongs to exactly one owner: an
// issue (issue_id) or a project (project_id) — enforced by owner_check. A row
// records one change: action/subject/from_text/to_text. actor_user_id is the
// author, taken from the session user (a member or an agent's bot user). actor_name
// is a snapshot so an entry still reads correctly after that user is renamed or
// deleted. Comments are stored in `comment`; feed_entry merges the two.
export const issueActivity = pgTable(
  'issue_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id').references(() => issue.id, {
      onDelete: 'cascade',
    }),
    projectId: uuid('project_id').references(() => project.id, {
      onDelete: 'cascade',
    }),
    actorUserId: uuid('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name'),
    action: text('action'),
    subject: text('subject'),
    fromText: text('from_text'),
    toText: text('to_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one owner: an issue row or an project row, never both or neither.
    check(
      'issue_activity_owner_check',
      sql`(${t.issueId} IS NOT NULL) <> (${t.projectId} IS NOT NULL)`,
    ),
    index('issue_activity_issue_idx').on(t.issueId, t.createdAt.desc(), t.id.desc()),
    index('issue_activity_project_idx').on(t.projectId, t.createdAt.desc(), t.id.desc()),
  ],
);

// Comments (Linear's Comment) on an issue, a project or a project update — exactly
// one of the three. A reply's parent_id is the root comment of its thread (replies
// are one level deep); a reply has the same parent entity as its root. user_name is
// the author's name at write time. resolved_at / resolving_* apply to root comments.
export const comment = pgTable(
  'comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    projectUpdateId: uuid('project_update_id').references(() => projectUpdate.id, {
      onDelete: 'cascade',
    }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comment.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    userName: text('user_name'),
    body: text('body').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvingUserId: uuid('resolving_user_id').references(() => user.id, { onDelete: 'set null' }),
    resolvingCommentId: uuid('resolving_comment_id').references((): AnyPgColumn => comment.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'comment_parent_check',
      sql`num_nonnulls(${t.issueId}, ${t.projectId}, ${t.projectUpdateId}) = 1`,
    ),
    index('comment_issue_idx').on(t.issueId, t.createdAt, t.id),
    index('comment_project_idx').on(t.projectId, t.createdAt, t.id),
    index('comment_project_update_idx').on(t.projectUpdateId, t.createdAt, t.id),
    index('comment_parent_idx').on(t.parentId),
    index('comment_resolving_comment_idx').on(t.resolvingCommentId),
  ],
);

// Emoji reactions (Linear's Reaction) on a comment, an issue or a project update —
// exactly one of the three. A user reacts once with each emoji on an item. emoji is
// stored as given (trimmed), such as `+1` or a Unicode emoji.
export const reaction = pgTable(
  'reaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id').references(() => comment.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    projectUpdateId: uuid('project_update_id').references(() => projectUpdate.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'reaction_parent_check',
      sql`num_nonnulls(${t.commentId}, ${t.issueId}, ${t.projectUpdateId}) = 1`,
    ),
    uniqueIndex('reaction_once_per_emoji_idx').on(
      sql`coalesce(${t.commentId}, ${t.issueId}, ${t.projectUpdateId})`,
      t.userId,
      t.emoji,
    ),
    // Reactions are read and cascaded per item.
    index('reaction_comment_idx').on(t.commentId),
    index('reaction_issue_idx').on(t.issueId),
    index('reaction_project_update_idx').on(t.projectUpdateId),
  ],
);

// The timeline of issues and projects: change-log rows and comments in one row
// shape, for the feeds (issue, range, share, team activity, project). kind is
// 'activity' or 'comment'; the columns a kind does not use are null.
export const feedEntry = pgView('feed_entry', {
  id: uuid('id').notNull(),
  issueId: uuid('issue_id'),
  projectId: uuid('project_id'),
  projectUpdateId: uuid('project_update_id'),
  kind: text('kind').notNull(),
  actorUserId: uuid('actor_user_id'),
  actorName: text('actor_name'),
  body: text('body'),
  action: text('action'),
  subject: text('subject'),
  fromText: text('from_text'),
  toText: text('to_text'),
  parentId: uuid('parent_id'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
}).as(sql`
  SELECT id, issue_id, project_id, NULL::uuid AS project_update_id, 'activity' AS kind,
    actor_user_id, actor_name, NULL::text AS body, action, subject, from_text, to_text,
    NULL::uuid AS parent_id, NULL::timestamptz AS edited_at, created_at
  FROM issue_activity
  UNION ALL
  SELECT id, issue_id, project_id, project_update_id, 'comment' AS kind,
    user_id, user_name, body, NULL, NULL, NULL, NULL, parent_id, edited_at, created_at
  FROM comment
`);

// Saved views (the tabs above a team's work items view). filters and display are jsonb
// blobs owned by the UI; the server stores and returns them without inspecting
// them. position orders the tabs.
export const teamView = pgTable(
  'team_view',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    filters: jsonb('filters').notNull().default({}),
    display: jsonb('display').notNull().default({}),
    position: doublePrecision('position').notNull().default(0),
    // Unguessable token for the public read-only share link of this view. NULL
    // means not shared; setting it enables the link, clearing it revokes access.
    shareToken: uuid('share_token').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_view_team_idx').on(t.teamId, t.position)],
);

// Saved dashboards (the analytics tabs of a team). layout is a jsonb blob
// owned by the UI: an ordered list of widget entries, each carrying its type,
// width, title, and widget-specific config. The server stores and returns it
// without inspecting it. position orders the tabs.
export const teamDashboard = pgTable(
  'team_dashboard',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    layout: jsonb('layout').notNull().default([]),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_dashboard_team_idx').on(t.teamId, t.position)],
);

// Note boards: a freeform canvas of sticky notes. canvas is a jsonb blob owned by
// the UI (React Flow nodes + edges + viewport), stored and returned verbatim.
// owner_user_id NULL means a public board visible to every team member; a set
// owner_user_id means a personal board only its owner can see or edit.
export const noteBoard = pgTable(
  'note_board',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    canvas: jsonb('canvas').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Listed by updatedAt within a team; the index covers the team filter.
  (t) => [index('note_board_team_idx').on(t.teamId, t.updatedAt)],
);

// Manual actions: saved macros on a team. condition is a filter set deciding
// which issues the action applies to (empty = always); effect is a partial
// issue patch applied in one update. Both jsonb blobs are owned by the UI.
export const teamAction = pgTable(
  'team_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Icon key for the action, resolved to a lucide icon by the UI (empty = default).
    icon: text('icon').notNull().default(''),
    condition: jsonb('condition').notNull().default({}),
    effect: jsonb('effect').notNull().default({}),
    position: doublePrecision('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_action_team_idx').on(t.teamId, t.position)],
);

// Outgoing webhook subscription (Linear's Webhook). A webhook covers one team
// (team_id) or every team, including teams created later (all_public_teams);
// exactly one of the two is set. resource_types lists the Linear resource types it
// receives (Issue, Comment, IssueLabel, Project, ProjectUpdate). Payloads are
// signed with `secret` (HMAC-SHA256); `enabled` gates delivery.
export const webhook = pgTable(
  'webhook',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'cascade' }),
    allPublicTeams: boolean('all_public_teams').notNull().default(false),
    url: text('url').notNull(),
    label: text('label'),
    secret: text('secret').notNull(),
    resourceTypes: jsonb('resource_types').notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    // Count of consecutive failed deliveries. Reset to 0 on a successful delivery.
    // When it crosses the worker's threshold the webhook is auto-disabled
    // (enabled set false) so one dead endpoint cannot occupy the worker.
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_team_idx').on(t.teamId),
    check('webhook_scope_check', sql`(${t.teamId} IS NOT NULL) <> ${t.allPublicTeams}`),
  ],
);

// Delivery queue (transactional outbox) for webhooks. One row per (event ×
// subscribed webhook), inserted in the same transaction as the domain change so
// it is atomic with it. The worker claims due rows, posts the payload to the
// webhook, and records the outcome. event_id is stable across retries so the
// receiver can deduplicate. status: pending | success | failed.
export const webhookDelivery = pgTable(
  'webhook_delivery',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhook.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    // Response from the last delivery attempt, for the delivery history view.
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Backs the worker's claim query: due pending rows ordered by next_attempt_at.
    index('webhook_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
    index('webhook_delivery_webhook_idx').on(t.webhookId),
  ],
);

// Per-user inbox notifications. One row per (recipient, event): a user is notified
// about an issue they are involved in (assigned to them, mentioned, or a participant
// on a comment/status change). The actor's own actions never notify the actor.
// team_id is denormalized from the issue so the inbox can filter and scope by
// team. source_activity_id points at the change-log row and source_comment_id at
// the comment that produced the notification (set null if that entry is later
// removed). type selects the kind.
// read_at NULL means unread; snoozed_until, when set and still in the future, hides
// the row from the default inbox until then.
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    sourceActivityId: uuid('source_activity_id').references(() => issueActivity.id, {
      onDelete: 'set null',
    }),
    sourceCommentId: uuid('source_comment_id').references((): AnyPgColumn => comment.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    actorUserId: uuid('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name'),
    readAt: timestamp('read_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'notification_type_check',
      sql`${t.type} IN ('assigned', 'mentioned', 'commented', 'state_changed')`,
    ),
    // Backs the inbox list: a user's notifications newest first.
    index('notification_user_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
    // Deleting a comment sets these to null.
    index('notification_source_comment_idx').on(t.sourceCommentId),
    // Backs the unread count and the unread-only inbox view.
    index('notification_user_unread_idx')
      .on(t.userId, t.id.desc())
      .where(sql`${t.readAt} IS NULL`),
  ],
);

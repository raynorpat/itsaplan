// Task planner tables: teams, workflow columns, labels, issues, and their
// dependent rows. Exposed to the web app over HTTP by
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
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oauthClient, user } from './auth';

// The workspace (Linear's Organization). One row per instance: `singleton` is always
// true and unique, so a second row cannot be inserted. The three *_role columns are
// the minimum workspace role for creating teams, managing workspace labels, project
// labels and project statuses, and inviting (owner, admin or member).
// allowed_auth_services lists the sign-in services allowed (email = magic link,
// google, passkey); empty means every configured one.
export const organization = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    singleton: boolean('singleton').notNull().default(true).unique(),
    name: text('name').notNull().default('Workspace'),
    urlKey: text('url_key').notNull().default('workspace'),
    logoUrl: text('logo_url'),
    allowedAuthServices: text('allowed_auth_services')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedFileUploadContentTypes: text('allowed_file_upload_content_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    teamCreationRole: text('team_creation_role').notNull().default('member'),
    labelManagementRole: text('label_management_role').notNull().default('member'),
    invitationsRole: text('invitations_role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('organization_singleton_check', sql`${t.singleton}`),
    check(
      'organization_roles_check',
      sql`${t.teamCreationRole} IN ('owner', 'admin', 'member') AND ${t.labelManagementRole} IN ('owner', 'admin', 'member') AND ${t.invitationsRole} IN ('owner', 'admin', 'member')`,
    ),
  ],
);

// A team groups its own columns, labels and
// issues. next_sequence is the atomic counter behind each issue's human
// identifier (e.g. "MKT-42"): incrementing it under a row lock keeps concurrent
// creates from colliding.
export const team = pgTable(
  'team',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    nextSequence: integer('next_sequence').notNull().default(1),
    // Linear's team visibility: a public team is open to every owner, admin and
    // member of the workspace; a private team only to its members.
    visibility: text('visibility').notNull().default('public'),
    // Cycles (Linear's team cycle settings). Weeks for duration and cooldown;
    // cycle_start_day is 0 = Sunday … 6 = Saturday. next_cycle_number issues cycle
    // numbers under a row lock, like next_sequence for issues.
    cyclesEnabled: boolean('cycles_enabled').notNull().default(false),
    cycleDuration: integer('cycle_duration').notNull().default(2),
    cycleStartDay: integer('cycle_start_day').notNull().default(1),
    cycleCooldownTime: integer('cycle_cooldown_time').notNull().default(0),
    upcomingCycleCount: integer('upcoming_cycle_count').notNull().default(2),
    cycleIssueAutoAssignStarted: boolean('cycle_issue_auto_assign_started')
      .notNull()
      .default(false),
    cycleIssueAutoAssignCompleted: boolean('cycle_issue_auto_assign_completed')
      .notNull()
      .default(false),
    nextCycleNumber: integer('next_cycle_number').notNull().default(1),
    // Linear's Team.autoArchivePeriod: completed and canceled issues closed longer than
    // this many months are archived by the worker; 0 turns it off.
    autoArchivePeriod: integer('auto_archive_period').notNull().default(6),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('team_visibility_check', sql`${t.visibility} IN ('public', 'private')`),
    check('team_auto_archive_period_check', sql`${t.autoArchivePeriod} IN (0, 1, 3, 6, 9, 12)`),
  ],
);

// Per-team key-value settings.
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

// A user's time zone (Linear's User.timezone), used by the web app to render stored
// UTC timestamps; the API keeps storing and returning UTC. An absent row means UTC.
export const userPreference = pgTable('user_preference', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  // Linear's User.timezone. The other interface preferences are kept in the browser.
  timezone: text('timezone').notNull().default('UTC'),
  // Linear's notificationCategoryPreferences, email channel: { assignments, mentions,
  // commentsAndReplies, statusChanges } → boolean. Null means the defaults (email for
  // assignments and mentions only).
  notificationCategories: jsonb('notification_categories').$type<Record<string, boolean>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// A user's extra email addresses, used only to match people during an issue import
// (apps/api src/accounts/emails.ts); sign-in uses `user.email` alone. `email` is
// lowercased. An address counts once confirmed (`verified_at`) through the link mailed
// to it; until then `token_hash` is the SHA-256 of the link's token. A confirmed
// address belongs to one user; pending ones may be claimed by several, and confirming
// one removes the others' pending rows.
export const userEmail = pgTable(
  'user_email',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    tokenHash: text('token_hash'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_email_user_email_uq').on(t.userId, t.email),
    uniqueIndex('user_email_verified_uq')
      .on(t.email)
      .where(sql`${t.verifiedAt} IS NOT NULL`),
    uniqueIndex('user_email_token_uq').on(t.tokenHash),
  ],
);

// Team membership (Linear's TeamMembership). Members of a private team are the only
// users who see it; a public team is open to the workspace's owners, admins and
// members, and joining it adds it to their teams. `owner` marks a team owner, who
// manages the team; the creator is one. Access is decided in
// apps/api/src/shared/access.ts.
export const teamMember = pgTable(
  'team_member',
  {
    // Linear's TeamMembership id; the primary key is (team_id, user_id).
    id: uuid('id').notNull().defaultRandom().unique(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Linear's team owner: manages the team's settings and members.
    owner: boolean('owner').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index('team_member_user_idx').on(t.userId),
  ],
);

// Workspace invites (Linear's organization invites). An invite carries the role the
// invited address gets and the teams it joins; both are applied when the address
// signs up (the better-auth user-create hook), and the invite is then deleted. One
// pending invite per address; an invite past expires_at is ignored and can be
// replaced.
export const workspaceInvite = pgTable(
  'workspace_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: uuid('token').notNull().defaultRandom().unique(),
    email: text('email').notNull().unique(),
    role: text('role').notNull().default('member'),
    teamIds: uuid('team_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    invitedByUserId: uuid('invited_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
  },
  (t) => [check('workspace_invite_role_check', sql`${t.role} IN ('admin', 'member', 'guest')`)],
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
    // When set, the column is archived: hidden from the board, GraphQL and MCP, and
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
    // Who retired it (Linear's IssueLabel.retiredBy); null when not retired.
    retiredByUserId: uuid('retired_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Names are unique per team, and among workspace labels (team_id null).
  (t) => [unique().on(t.teamId, t.name).nullsNotDistinct()],
);

// Outbox for outbound notification delivery. One row per (recipient, message) to
// send for an issue event: an email to one member. Rows are enqueued when inbox
// notifications are created (see apps/api/src/notifications/outbound.ts) and drained
// by the worker following the same claim/retry pattern as webhook_delivery. The
// message text is composed at enqueue time and stored in `payload`; the instance
// email credentials are read at send time. channel is 'email'. recipient is the
// member's email address.
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
    check('notification_delivery_channel_check', sql`${t.channel} IN ('email')`),
    // Backs the worker's claim query: due pending rows ordered by next_attempt_at.
    index('notification_delivery_due_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
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
    // Set with archived_at by projectDelete (Linear's trash); the worker deletes a
    // project 30 days after archived_at while it is set.
    trashed: boolean('trashed'),
    // Linear's progress histories: one value per UTC day from history_start (the
    // start date, else the creation day, when the history was built), appended
    // daily by the worker. history_start is null until the history is first built
    // from issue_activity (projects/progress.ts).
    historyStart: date('history_start'),
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

// Linear's project members: the people working on a project, set by
// `memberIds` (the list is replaced). A member can see the project.
export const projectMember = pgTable(
  'project_member',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_member_user_idx').on(t.userId),
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
    // Set by projectUpdateArchive; an archived update is left out of the project's
    // updates and health.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
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

// A Linear initiative: a workspace-level goal grouping projects
// (initiative_to_project) and sub-initiatives (initiative_relation). An initiative
// with a lead team is visible to that team only; without one, to the workspace.
// started_at is set on entering Active; completed_at is set on entering Completed
// and cleared on leaving it. Health is the newest initiative update's health.
export const initiative = pgTable(
  'initiative',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    content: text('content'),
    color: text('color'),
    icon: text('icon'),
    status: text('status').notNull().default('Active'),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    leadTeamId: uuid('lead_team_id').references(() => team.id, { onDelete: 'set null' }),
    // Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    priority: integer('priority').notNull().default(0),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    prioritySortOrder: doublePrecision('priority_sort_order').notNull().default(0),
    targetDate: date('target_date'),
    targetDateResolution: text('target_date_resolution'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // Linear's short initiative id (12 lowercase hex chars), usable in place of the id.
    slugId: text('slug_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(gen_random_uuid()::text), 1, 12)`),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // Set with archived_at by initiativeDelete (Linear's trash).
    trashed: boolean('trashed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'initiative_status_check',
      sql`${t.status} IN ('Proposed', 'Planned', 'Active', 'Completed', 'Canceled')`,
    ),
    check('initiative_priority_check', sql`${t.priority} BETWEEN 0 AND 4`),
    check(
      'initiative_target_date_resolution_check',
      sql`${t.targetDateResolution} IN ('month', 'quarter', 'halfYear', 'year')`,
    ),
    index('initiative_lead_team_idx').on(t.leadTeamId),
  ],
);

// A project linked to an initiative (Linear's InitiativeToProject). A project may
// be linked to several initiatives, once each.
export const initiativeToProject = pgTable(
  'initiative_to_project',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiativeId: uuid('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('initiative_to_project_unique').on(t.initiativeId, t.projectId),
    index('initiative_to_project_project_idx').on(t.projectId),
  ],
);

// A sub-initiative link (Linear's InitiativeRelation): initiative_id is the parent,
// related_initiative_id the child. A child has one parent; loops and depth are
// checked by the store.
export const initiativeRelation = pgTable(
  'initiative_relation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiativeId: uuid('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    relatedInitiativeId: uuid('related_initiative_id')
      .notNull()
      .unique()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('initiative_relation_not_self', sql`${t.initiativeId} <> ${t.relatedInitiativeId}`),
    index('initiative_relation_parent_idx').on(t.initiativeId),
  ],
);

// An initiative update: a status post with a health reading. The newest one that
// is not archived gives the initiative its health.
export const initiativeUpdate = pgTable(
  'initiative_update',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    initiativeId: uuid('initiative_id')
      .notNull()
      .references(() => initiative.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    health: text('health').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('initiative_update_health_check', sql`${t.health} IN ('onTrack', 'atRisk', 'offTrack')`),
    index('initiative_update_initiative_idx').on(t.initiativeId, t.createdAt.desc()),
  ],
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
    // Linear's issue delegate: the agent (app user) an issue is delegated to. No
    // user can be a delegate until Linear's agent API exists; only null is
    // accepted.
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
    // Linear's Issue.externalUserCreator: the requester who suggested it on the portal.
    externalUserCreatorId: uuid('external_user_creator_id').references(
      (): AnyPgColumn => externalUser.id,
      { onDelete: 'set null' },
    ),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // Linear's priority scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
    priority: integer('priority').notNull().default(0),
    estimate: real('estimate'),
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

// A relation between two issues (Linear's IssueRelation). blocks: the issue blocks
// the related issue; duplicate: the issue is a duplicate of the related issue;
// related: symmetric. One relation per unordered pair of issues.
export const issueRelation = pgTable(
  'issue_relation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    relatedIssueId: uuid('related_issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('issue_relation_type_check', sql`${t.type} IN ('blocks', 'duplicate', 'related')`),
    check('issue_relation_not_self', sql`${t.issueId} <> ${t.relatedIssueId}`),
    uniqueIndex('issue_relation_pair_idx').on(
      sql`least(${t.issueId}, ${t.relatedIssueId})`,
      sql`greatest(${t.issueId}, ${t.relatedIssueId})`,
    ),
    index('issue_relation_issue_idx').on(t.issueId),
    index('issue_relation_related_idx').on(t.relatedIssueId),
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

// Attachments on issues (Linear's Attachment): a link, or an uploaded file. A link
// has only the url/title fields; an upload also has the file columns (all set or all
// null, file_check), its bytes in the S3-compatible object store, url =
// /attachments/<public_id>/raw and source_type 'upload'. public_id is the unguessable
// id used in the public download URL. One attachment per URL on an issue.
export const attachment = pgTable(
  'attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    iconUrl: text('icon_url'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    sourceType: text('source_type'),
    groupBySource: boolean('group_by_source').notNull().default(false),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    // The person outside the workspace the attachment is from (Linear's
    // externalUserCreator): the requester of a feedback item's source attachment.
    externalUserCreatorId: uuid('external_user_creator_id').references(() => externalUser.id, {
      onDelete: 'set null',
    }),
    publicId: uuid('public_id').unique(),
    s3Key: text('s3_key'),
    filename: text('filename'),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachment_issue_idx').on(t.issueId),
    // md5 of the URL: a btree entry cannot hold a URL longer than about 2.7 kB.
    uniqueIndex('attachment_issue_url_idx').on(t.issueId, sql`md5(${t.url})`),
    check('attachment_title_check', sql`btrim(${t.title}) <> ''`),
    check(
      'attachment_file_check',
      sql`num_nonnulls(${t.publicId}, ${t.s3Key}, ${t.filename}, ${t.contentType}, ${t.sizeBytes}) in (0, 5)`,
    ),
  ],
);

// A person outside the workspace (Linear's ExternalUser): someone who gave feedback.
// `email` is stored lowercased and is unique when set. A requester merged into another
// keeps its row with `merged_into_id` set, so old references still resolve.
export const externalUser = pgTable(
  'external_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    createdById: uuid('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => externalUser.id, {
      onDelete: 'set null',
    }),
    lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    // Set when an owner or admin blocks the person from the portal.
    portalBlockedAt: timestamp('portal_blocked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('external_user_email_uq')
      .on(t.email)
      .where(sql`${t.email} IS NOT NULL AND ${t.mergedIntoId} IS NULL`),
    check('external_user_email_lower_check', sql`${t.email} = lower(${t.email})`),
    check('external_user_name_check', sql`btrim(${t.name}) <> ''`),
  ],
);

// Feedback on an issue (Linear's CustomerNeed): `body` is the quote, `priority` 1 marks
// it important, `attachment_id` its source attachment (whose external creator is the
// requester), `creator_id` the member who logged it.
export const customerNeed = pgTable(
  'customer_need',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').references(() => attachment.id, {
      onDelete: 'set null',
    }),
    body: text('body'),
    priority: integer('priority').notNull().default(0),
    creatorId: uuid('creator_id').references(() => user.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_need_issue_idx').on(t.issueId),
    uniqueIndex('customer_need_attachment_uq').on(t.attachmentId),
    check('customer_need_priority_check', sql`${t.priority} IN (0, 1)`),
  ],
);

// A portal board: the issues of one team or one project (optionally only those with
// any of `label_ids`) shown at /portal/<slug> to people outside the workspace.
// `access` public: anyone reads; restricted: only visitors whose email domain is in
// `allowed_domains` or whose address is in `allowed_emails` (both lowercased).
// `comments` portal: only the board's portal threads are shown; all: every comment
// except other boards' threads. Suggestions create issues in the suggestion team,
// state and label.
export const portalBoard = pgTable(
  'portal_board',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    intro: text('intro').notNull().default(''),
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    labelIds: uuid('label_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    access: text('access').notNull().default('public'),
    allowedDomains: text('allowed_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedEmails: text('allowed_emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    showDescription: boolean('show_description').notNull().default(false),
    comments: text('comments').notNull().default('portal'),
    suggestionsEnabled: boolean('suggestions_enabled').notNull().default(false),
    suggestionTeamId: uuid('suggestion_team_id').references(() => team.id, {
      onDelete: 'set null',
    }),
    suggestionStateId: uuid('suggestion_state_id').references(() => workflowState.id, {
      onDelete: 'set null',
    }),
    suggestionLabelId: uuid('suggestion_label_id').references(() => label.id, {
      onDelete: 'set null',
    }),
    enabled: boolean('enabled').notNull().default(true),
    createdById: uuid('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('portal_board_slug_uq').on(t.slug),
    check('portal_board_slug_check', sql`${t.slug} ~ '^[a-z0-9-]{1,48}$'`),
    check('portal_board_scope_check', sql`(${t.teamId} IS NULL) <> (${t.projectId} IS NULL)`),
    check('portal_board_access_check', sql`${t.access} IN ('public', 'restricted')`),
    check('portal_board_comments_check', sql`${t.comments} IN ('portal', 'all')`),
  ],
);

// Change log of issues and projects. Each row belongs to exactly one owner: an
// issue (issue_id) or a project (project_id) — enforced by owner_check. A row
// records one change: action/subject/from_text/to_text. actor_user_id is the
// author, taken from the session user (a member). actor_name
// is a snapshot so an entry still reads correctly after that user is renamed or
// deleted. Comments are stored in `comment`.
// A team automation rule (Linear's WorkflowDefinition, apps/api src/workflows): when an
// issue of the team is created (trigger entityCreated) or starts matching `conditions`
// on an update (entityUpdated with activation_mode conditionsStartedMatching), the
// `activities` are applied. `conditions` is Linear's IssueFilter; `activities` is a
// list of { type, ... } actions; both are validated by the API on save. `stats` is
// { runs, lastError? }. edit_access decides who may change the rule.
export const workflowDefinition = pgTable(
  'workflow_definition',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slugId: text('slug_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(gen_random_uuid()::text), 1, 12)`),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    type: text('type').notNull().default('automation'),
    triggerType: text('trigger_type').notNull().default('issue'),
    trigger: text('trigger').notNull(),
    activationMode: text('activation_mode'),
    conditions: jsonb('conditions').notNull().default({}),
    activities: jsonb('activities').notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    editAccess: text('edit_access').notNull().default('teamOwners'),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    lastExecutedAt: timestamp('last_executed_at', { withTimezone: true }),
    stats: jsonb('stats').notNull().default({ runs: 0 }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // A deleted rule keeps its row so the history, comments and notifications it made
    // still name it; it is never listed, read, edited or run.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('workflow_definition_type_check', sql`${t.type} = 'automation'`),
    check('workflow_definition_trigger_type_check', sql`${t.triggerType} = 'issue'`),
    check(
      'workflow_definition_trigger_check',
      sql`${t.trigger} IN ('entityCreated', 'entityUpdated')`,
    ),
    check(
      'workflow_definition_edit_access_check',
      sql`${t.editAccess} IN ('everyone', 'teamOwners', 'workspaceAdmins', 'owner')`,
    ),
    // An update rule runs when the issue starts matching; a create rule has no mode.
    check(
      'workflow_definition_activation_mode_check',
      sql`(${t.trigger} = 'entityUpdated' AND ${t.activationMode} = 'conditionsStartedMatching')
        OR (${t.trigger} = 'entityCreated' AND ${t.activationMode} IS NULL)`,
    ),
    index('workflow_definition_team_idx').on(t.teamId, t.sortOrder),
  ],
);

// A one-time issue import (Linear's IssueImport) from GitHub, GitLab, Gitea or
// Forgejo (apps/api/src/imports). `status` is Linear's: inProgress (fetching, then
// waiting for people matching), inProcess (creating records), complete, error.
// `progress` is 0–100 for the current step. `service_metadata` holds the source
// (repository, host) and never a token; `mapping` the people matching (source person
// key → user id or null); `summary` the counts of the processing step. The team is
// `team_id`, or `team_name` for a team the import creates when it processes.
export const issueImport = pgTable(
  'issue_import',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    service: text('service').notNull(),
    status: text('status').notNull(),
    progress: real('progress'),
    teamId: uuid('team_id').references(() => team.id, { onDelete: 'set null' }),
    teamName: text('team_name'),
    creatorId: uuid('creator_id').references(() => user.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    serviceMetadata: jsonb('service_metadata').$type<Record<string, unknown>>(),
    mapping: jsonb('mapping').$type<Record<string, unknown>>(),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One import creating issues (`inProcess`) per team at a time.
  (t) => [
    uniqueIndex('issue_import_team_in_process_uq')
      .on(t.teamId)
      .where(sql`${t.status} = 'inProcess'`),
  ],
);

// A workspace integration (Linear's Integration). Only `githubImport` is used: the
// GitHub Import App installation that GitHub issue imports read through
// (apps/api/src/imports/github.ts). `installation_id` is GitHub's installation id; no
// GitHub token is stored (installation tokens are minted from the app's key on use).
// One row per service.
export const integration = pgTable('integration', {
  id: uuid('id').primaryKey().defaultRandom(),
  service: text('service').notNull().unique(),
  installationId: text('installation_id').notNull(),
  // Who connected it; the connection outlives that account.
  creatorId: uuid('creator_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    // The workflow that made the change (no user actor then); null for a person's.
    workflowDefinitionId: uuid('workflow_definition_id').references(() => workflowDefinition.id, {
      onDelete: 'set null',
    }),
    action: text('action'),
    subject: text('subject'),
    fromText: text('from_text'),
    toText: text('to_text'),
    // Ids of the referenced rows (state, user, project, cycle, label, related
    // issue, project status), recorded since the GraphQL history; no foreign key,
    // so a deleted row leaves the id and its name snapshot in from_text / to_text.
    fromId: uuid('from_id'),
    toId: uuid('to_id'),
    // The import that created the issue, on its `created` entry (Linear's
    // IssueHistory.issueImport).
    issueImportId: uuid('issue_import_id').references(() => issueImport.id, {
      onDelete: 'set null',
    }),
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

// A document (Linear's Document): a titled Markdown page in a project or on an
// issue — exactly one of the two. Its id is also Linear's documentContentId, the
// id comments on the document refer to. documentDelete trashes it: archived_at
// and trashed are set together.
export const document = pgTable(
  'document',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    content: text('content'),
    icon: text('icon'),
    color: text('color'),
    sortOrder: doublePrecision('sort_order').notNull().default(0),
    // Linear's short document id (12 lowercase hex chars), usable in place of the id.
    slugId: text('slug_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(gen_random_uuid()::text), 1, 12)`),
    projectId: uuid('project_id').references(() => project.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id').references(() => issue.id, { onDelete: 'cascade' }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    trashed: boolean('trashed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('document_parent_check', sql`num_nonnulls(${t.projectId}, ${t.issueId}) = 1`),
    index('document_project_idx').on(t.projectId),
    index('document_issue_idx').on(t.issueId),
  ],
);

// Comments (Linear's Comment) on an issue, a project, a project update, an
// initiative update or a document — exactly one of the five. A reply's parent_id is the root comment of its thread (replies
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
    initiativeUpdateId: uuid('initiative_update_id').references(() => initiativeUpdate.id, {
      onDelete: 'cascade',
    }),
    documentId: uuid('document_id').references(() => document.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => comment.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    userName: text('user_name'),
    // The workflow that posted the comment (no user author then).
    workflowDefinitionId: uuid('workflow_definition_id').references(() => workflowDefinition.id, {
      onDelete: 'set null',
    }),
    // A portal visitor's comment (Linear's Comment.externalUser): no user author then.
    externalUserId: uuid('external_user_id').references((): AnyPgColumn => externalUser.id, {
      onDelete: 'set null',
    }),
    // On a root comment: the portal board whose thread it starts (Linear's
    // externalThread). Replies belong to their root's board.
    portalBoardId: uuid('portal_board_id').references((): AnyPgColumn => portalBoard.id, {
      onDelete: 'set null',
    }),
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
      sql`num_nonnulls(${t.issueId}, ${t.projectId}, ${t.projectUpdateId}, ${t.initiativeUpdateId}, ${t.documentId}) = 1`,
    ),
    index('comment_issue_idx').on(t.issueId, t.createdAt, t.id),
    index('comment_project_idx').on(t.projectId, t.createdAt, t.id),
    index('comment_project_update_idx').on(t.projectUpdateId, t.createdAt, t.id),
    index('comment_initiative_update_idx').on(t.initiativeUpdateId, t.createdAt, t.id),
    index('comment_document_idx').on(t.documentId, t.createdAt, t.id),
    index('comment_parent_idx').on(t.parentId),
    index('comment_resolving_comment_idx').on(t.resolvingCommentId),
  ],
);

// Emoji reactions (Linear's Reaction) on a comment, an issue, a project update or
// an initiative update — exactly one of the four. A user reacts once with each emoji on an item. emoji is
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
    initiativeUpdateId: uuid('initiative_update_id').references(() => initiativeUpdate.id, {
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
      sql`num_nonnulls(${t.commentId}, ${t.issueId}, ${t.projectUpdateId}, ${t.initiativeUpdateId}) = 1`,
    ),
    uniqueIndex('reaction_once_per_emoji_idx').on(
      sql`coalesce(${t.commentId}, ${t.issueId}, ${t.projectUpdateId}, ${t.initiativeUpdateId})`,
      t.userId,
      t.emoji,
    ),
    // Reactions are read and cascaded per item.
    index('reaction_comment_idx').on(t.commentId),
    index('reaction_issue_idx').on(t.issueId),
    index('reaction_project_update_idx').on(t.projectUpdateId),
    index('reaction_initiative_update_idx').on(t.initiativeUpdateId),
  ],
);

// Saved views (the tabs above a team's work items view). filters and display are jsonb
// blobs owned by the UI; the server stores and returns them without inspecting
// them. Tabs are ordered by creation.
export const teamView = pgTable(
  'team_view',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    // Linear's IssueFilter, the view's only stored filter.
    filterData: jsonb('filter_data').notNull().default({}),
    shared: boolean('shared').notNull().default(true),
    slugId: text('slug_id')
      .notNull()
      .unique()
      .default(sql`substr(md5(random()::text), 1, 12)`),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    ownerUserId: uuid('owner_user_id').references(() => user.id, { onDelete: 'set null' }),
    updatedByUserId: uuid('updated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('team_view_team_idx').on(t.teamId, t.createdAt)],
);

// Linear's ViewPreferences for a custom view: the layout and display settings.
// A saved view's preferences: `organization` rows are the view's shared defaults (one
// per view); `user` rows override them for one user. A `user` row without a saved view
// is the user's own preferences for a list kind (`view_type` allIssues, project, cycle
// or myIssues; one per user and view type), Linear's `userViewPreferences(viewType)`.
// `preferences` is Linear's ViewPreferencesValues as JSON (the web's display blob,
// with Linear's key names where they exist, such as `layout`).
export const viewPreferences = pgTable(
  'view_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    viewType: text('view_type').notNull(),
    customViewId: uuid('custom_view_id').references(() => teamView.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => user.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('view_preferences_type_check', sql`${t.type} IN ('organization', 'user')`),
    check('view_preferences_user_check', sql`(${t.type} = 'user') = (${t.userId} IS NOT NULL)`),
    uniqueIndex('view_preferences_org_uq')
      .on(t.customViewId)
      .where(sql`${t.type} = 'organization'`),
    uniqueIndex('view_preferences_user_uq')
      .on(t.customViewId, t.userId)
      .where(sql`${t.type} = 'user'`),
    check(
      'view_preferences_view_type_check',
      sql`${t.customViewId} IS NOT NULL OR (${t.type} = 'user' AND ${t.viewType} IN ('allIssues', 'project', 'cycle', 'myIssues'))`,
    ),
    uniqueIndex('view_preferences_user_view_type_uq')
      .on(t.userId, t.viewType)
      .where(sql`${t.customViewId} IS NULL`),
  ],
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
    // The OAuth application whose webhook this is (one per application). Its events
    // follow the application's reach (webhooks/event.ts), not a team or all teams.
    oauthClientId: text('oauth_client_id')
      .unique()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    // Count of consecutive failed deliveries. Reset to 0 on a successful delivery.
    // When it crosses the worker's threshold the webhook is auto-disabled
    // (enabled set false) so one dead endpoint cannot occupy the worker.
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_team_idx').on(t.teamId),
    // Exactly one of: a team, all public teams, an OAuth application.
    check(
      'webhook_scope_check',
      sql`(${t.teamId} IS NOT NULL)::int + ${t.allPublicTeams}::int + (${t.oauthClientId} IS NOT NULL)::int = 1`,
    ),
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

// Linear's fileUpload: a pending upload of one file by one user. `token` is the
// secret in the signed upload URL (single use: `completed_at` is set when the bytes
// are stored, and a stored upload refuses another PUT); the content type and size are
// bound at request time. `used_at` is set when an attachment or an avatar takes the
// upload; the worker deletes uploads nothing used within 24 hours.
export const fileUpload = pgTable(
  'file_upload',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: uuid('token').notNull().defaultRandom().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    filename: text('filename').notNull(),
    size: integer('size').notNull(),
    objectKey: text('object_key').notNull(),
    metaData: jsonb('meta_data'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('file_upload_user_idx').on(t.userId),
    index('file_upload_created_idx').on(t.createdAt),
  ],
);

// Users subscribed to an issue (Linear's issue subscribers). Subscribers receive the
// issue's comment and status-change notifications. Rows are added automatically
// (creator, assignee, commenter, mentioned member) and by issueSubscribe; only
// members of the issue's team are notified or listed.
export const issueSubscription = pgTable(
  'issue_subscription',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.userId] }),
    index('issue_subscription_user_idx').on(t.userId),
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
    // Linear's AgentSessionNotification: the session and the activity (an elicitation
    // or a response) it is about. Set only for the agent types.
    agentSessionId: uuid('agent_session_id').references((): AnyPgColumn => agentSession.id, {
      onDelete: 'cascade',
    }),
    agentActivityId: uuid('agent_activity_id').references((): AnyPgColumn => agentActivity.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    actorName: text('actor_name'),
    // The workflow whose change caused the notification (no user actor then).
    workflowDefinitionId: uuid('workflow_definition_id').references(() => workflowDefinition.id, {
      onDelete: 'set null',
    }),
    readAt: timestamp('read_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    // Set by Linear's notificationArchive; an archived notification leaves the inbox.
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'notification_type_check',
      sql`${t.type} IN ('assigned', 'mentioned', 'commented', 'state_changed', 'agent_needs_input', 'agent_responded')`,
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

// An OAuth application installed in the workspace with `actor=app` (Linear's app
// actor): an admin or owner installs it, and it gets one app user
// (`user.workspace_role` = 'app') that its install tokens act as. The app user sees
// every public team when `public_teams` is set, and the teams it is a member of
// (`team_member` rows added at install). `scopes` are the scopes granted at install;
// `app:assignable` and `app:mentionable` decide whether it is offered in pickers.
// Uninstalling sets `uninstalled_at` and suspends the app user; installing again
// reuses the row and the app user.
export const oauthInstallation = pgTable('oauth_installation', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id')
    .notNull()
    .unique()
    .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  appUserId: uuid('app_user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  publicTeams: boolean('public_teams').notNull().default(true),
  scopes: text('scopes').array().notNull(),
  installedByUserId: uuid('installed_by_user_id').references(() => user.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  uninstalledAt: timestamp('uninstalled_at', { withTimezone: true }),
});

// Linear's agent session: an app user's work on an issue, started by delegating the
// issue to it, by mentioning it in a comment, or by the application itself. Its thread
// is a root comment on the issue (`comment_id`); `source_comment_id` is the comment in
// that thread that started it, when that is not the root. `status` is one of Linear's
// AgentSessionStatus values. `plan` is Linear's plan object ({ entries, updatedAt });
// `external_urls` an array of { url, label }.
export const agentSession = pgTable(
  'agent_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slugId: text('slug_id').notNull().unique(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issue.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comment.id, { onDelete: 'set null' }),
    sourceCommentId: uuid('source_comment_id').references(() => comment.id, {
      onDelete: 'set null',
    }),
    appUserId: uuid('app_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    creatorUserId: uuid('creator_user_id').references(() => user.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'),
    // Started by delegating the issue to the app user (or prompted by a delegation).
    delegated: boolean('delegated').notNull().default(false),
    summary: text('summary'),
    plan: jsonb('plan'),
    externalLink: text('external_link'),
    externalUrls: jsonb('external_urls').notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    dismissedByUserId: uuid('dismissed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_session_issue_idx').on(t.issueId),
    index('agent_session_app_user_idx').on(t.appUserId),
    index('agent_session_comment_idx').on(t.commentId),
    // One session per app in a comment thread, and one open delegation session per
    // app on an issue; a second trigger prompts the existing one.
    uniqueIndex('agent_session_thread_app_uq').on(t.commentId, t.appUserId),
    uniqueIndex('agent_session_open_delegation_uq')
      .on(t.issueId, t.appUserId)
      .where(
        sql`${t.delegated} AND ${t.status} IN ('pending', 'active', 'awaitingInput', 'stopping')`,
      ),
    check(
      'agent_session_status_check',
      sql`${t.status} IN ('pending', 'active', 'stopping', 'awaitingInput', 'complete', 'error', 'stale')`,
    ),
  ],
);

// Linear's agent activity: one entry of a session. `type` is Linear's
// AgentActivityType; `content` holds the type's fields (body; or action, parameter
// and result). Agent output is written by the app user, prompts by people.
export const agentActivity = pgTable(
  'agent_activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    content: jsonb('content').notNull(),
    signal: text('signal'),
    signalMetadata: jsonb('signal_metadata'),
    ephemeral: boolean('ephemeral').notNull().default(false),
    sourceCommentId: uuid('source_comment_id').references(() => comment.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_activity_session_idx').on(t.sessionId),
    check(
      'agent_activity_type_check',
      sql`${t.type} IN ('thought', 'action', 'elicitation', 'response', 'error', 'prompt')`,
    ),
    check(
      'agent_activity_signal_check',
      sql`${t.signal} IS NULL OR ${t.signal} IN ('auth', 'continue', 'select', 'stop')`,
    ),
  ],
);

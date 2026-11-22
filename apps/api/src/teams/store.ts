import {
  db,
  issueType,
  project,
  projectTeam,
  team,
  workflowState,
  teamMember,
  teamRole,
  teamSetting,
} from '@repo/db';
import { and, eq, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';
import {
  defaultMemberPermissions,
  fullPermissions,
  normalizePermissions,
  type Permissions,
} from '../shared/permissions';
import { getTeamSetting, setTeamSetting } from '../settings/store';
import { deleteThreadsWhere } from '../ai-agents/runtime/memory';

// Data access for teams: the top-level container that groups its own columns,
// issue types, labels, assignees, custom fields, issues, saved views, and
// actions. Access is by membership (team_member): the creator becomes an
// "owner" and only members can reach a team's entities.

export interface TeamRow {
  id: string;
  key: string;
  name: string;
  description: string;
  mcpEnabled: boolean;
  projectsEnabled: boolean;
  createdAt: string;
}

// The optional sections an owner can turn off per team (Settings -> General).
// A disabled section is hidden in the web app; its rows are kept.
export interface TeamFeatures {
  projects: boolean;
}

// A team in the caller's list, carrying the caller's own role in it. The list
// UI (team switcher, manage-teams page) uses `role` to gate owner-only
// actions like deletion; the API still enforces the permission on every request.
export interface TeamListItem extends TeamRow {
  role: 'owner' | 'member';
  // The caller's resolved permission matrix in this team. Present only when the
  // list is requested with permissions (opts.withPermissions); omitted otherwise.
  permissions?: Permissions;
}

function mapTeam(row: typeof team.$inferSelect): TeamRow {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    mcpEnabled: row.mcpEnabled,
    projectsEnabled: row.projectsEnabled,
    createdAt: iso(row.createdAt),
  };
}

// Only the teams the user is a member of, ordered by key. Each carries the
// caller's role in that team (owner | member). When mcpOnly is set, teams
// with MCP disabled are excluded, so an MCP caller only sees teams it can work
// with.
export async function listTeams(
  userId: string,
  opts: { mcpOnly?: boolean; withPermissions?: boolean } = {},
): Promise<TeamListItem[]> {
  const where = opts.mcpOnly
    ? and(eq(teamMember.userId, userId), eq(team.mcpEnabled, true))
    : eq(teamMember.userId, userId);
  const rows = await db
    .select({
      id: team.id,
      key: team.key,
      name: team.name,
      description: team.description,
      mcpEnabled: team.mcpEnabled,
      projectsEnabled: team.projectsEnabled,
      createdAt: team.createdAt,
      role: teamMember.role,
      rolePermissions: teamRole.permissions,
    })
    .from(team)
    .innerJoin(teamMember, eq(teamMember.teamId, team.id))
    .leftJoin(teamRole, eq(teamRole.id, teamMember.roleId))
    .where(where)
    .orderBy(team.key);
  return rows.map(({ rolePermissions, ...r }) => {
    const role = r.role === 'owner' ? 'owner' : 'member';
    const item: TeamListItem = { ...r, createdAt: iso(r.createdAt), role };
    if (opts.withPermissions) {
      item.permissions =
        role === 'owner'
          ? fullPermissions()
          : rolePermissions
            ? normalizePermissions(rolePermissions)
            : defaultMemberPermissions();
    }
    return item;
  });
}

export async function getTeamByKey(key: string): Promise<TeamRow | null> {
  const rows = await db.select().from(team).where(eq(team.key, key));
  return rows[0] ? mapTeam(rows[0]) : null;
}

export async function getTeamById(id: string): Promise<TeamRow | null> {
  const rows = await db.select().from(team).where(eq(team.id, id));
  return rows[0] ? mapTeam(rows[0]) : null;
}

// Every new team starts with one column per state type, so it's usable (has
// somewhere to put an issue) without a trip to Settings first.
export const DEFAULT_COLUMNS: { name: string; stateType: string; color: string }[] = [
  { name: 'Backlog', stateType: 'backlog', color: '#71717a' },
  { name: 'Todo', stateType: 'unstarted', color: '#6b7280' },
  { name: 'In Progress', stateType: 'started', color: '#eab308' },
  { name: 'Done', stateType: 'completed', color: '#22c55e' },
  { name: 'Canceled', stateType: 'canceled', color: '#ef4444' },
];

// Issue types a new team starts with, picked by sphere of work in the create
// dialog. The first entry of a set becomes the team's default type. "general"
// is the fallback when no preset is chosen: a single Task, so the team is
// usable without committing to a classification.
export const ISSUE_TYPE_PRESETS: Record<string, { name: string; color: string }[]> = {
  general: [{ name: 'Task', color: '#0ea5e9' }],
  software: [
    { name: 'Feature', color: '#8b5cf6' },
    { name: 'Bug', color: '#e11d48' },
    { name: 'Task', color: '#0ea5e9' },
    { name: 'Tech debt', color: '#f97316' },
    { name: 'Research', color: '#14b8a6' },
  ],
  product: [
    { name: 'Epic', color: '#8b5cf6' },
    { name: 'Feature', color: '#0ea5e9' },
    { name: 'Feedback', color: '#eab308' },
    { name: 'Research', color: '#14b8a6' },
  ],
  content: [
    { name: 'Article', color: '#0ea5e9' },
    { name: 'Video', color: '#e11d48' },
    { name: 'Social post', color: '#8b5cf6' },
    { name: 'Idea', color: '#eab308' },
    { name: 'Review', color: '#22c55e' },
  ],
  marketing: [
    { name: 'Campaign', color: '#8b5cf6' },
    { name: 'Landing', color: '#0ea5e9' },
    { name: 'Asset', color: '#14b8a6' },
    { name: 'Email', color: '#f97316' },
    { name: 'Research', color: '#22c55e' },
  ],
  design: [
    { name: 'Screen', color: '#0ea5e9' },
    { name: 'Component', color: '#8b5cf6' },
    { name: 'Asset', color: '#14b8a6' },
    { name: 'Research', color: '#22c55e' },
  ],
  sales: [
    { name: 'Lead', color: '#0ea5e9' },
    { name: 'Deal', color: '#22c55e' },
    { name: 'Follow-up', color: '#eab308' },
    { name: 'Account', color: '#8b5cf6' },
  ],
  operations: [
    { name: 'Request', color: '#0ea5e9' },
    { name: 'Process', color: '#8b5cf6' },
    { name: 'Purchase', color: '#22c55e' },
    { name: 'Maintenance', color: '#f97316' },
  ],
  support: [
    { name: 'Incident', color: '#e11d48' },
    { name: 'Request', color: '#0ea5e9' },
    { name: 'Question', color: '#eab308' },
    { name: 'Change', color: '#8b5cf6' },
  ],
  recruiting: [
    { name: 'Candidate', color: '#0ea5e9' },
    { name: 'Onboarding', color: '#22c55e' },
    { name: 'Request', color: '#8b5cf6' },
    { name: 'Policy', color: '#6b7280' },
  ],
};

export const ISSUE_TYPE_PRESET_KEYS = Object.keys(ISSUE_TYPE_PRESETS);

export type IssueTypePreset = keyof typeof ISSUE_TYPE_PRESETS;

export async function createTeam(
  input: {
    key: string;
    name: string;
    description?: string;
    preset?: string;
  },
  ownerId: string,
): Promise<TeamRow> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(team)
      .values({
        key: input.key.toUpperCase(),
        name: input.name,
        description: input.description ?? '',
      })
      .returning();
    await tx.insert(teamMember).values({ teamId: row.id, userId: ownerId, role: 'owner' });
    // Every team starts with a default "Member" role, assigned to members that
    // join through an invite.
    await tx.insert(teamRole).values({
      teamId: row.id,
      name: 'Member',
      isDefault: true,
      permissions: defaultMemberPermissions(),
    });
    for (const [position, column] of DEFAULT_COLUMNS.entries()) {
      await tx.insert(workflowState).values({
        teamId: row.id,
        name: column.name,
        stateType: column.stateType,
        color: column.color,
        position,
      });
    }
    const types = ISSUE_TYPE_PRESETS[input.preset ?? 'general'] ?? ISSUE_TYPE_PRESETS.general;
    for (const [position, type] of types.entries()) {
      await tx.insert(issueType).values({
        teamId: row.id,
        name: type.name,
        color: type.color,
        isDefault: position === 0,
        position,
      });
    }
    await tx
      .insert(teamSetting)
      .values({ teamId: row.id, key: AUTO_ARCHIVE_KEY, value: DEFAULT_AUTO_ARCHIVE });
    return mapTeam(row);
  });
}

// Updates a team's editable metadata (name, description). The key is the
// issue-identifier prefix (e.g. "MKT-42") and is immutable, so it is not editable
// here. Only the provided fields change.
export async function updateTeam(
  teamId: string,
  patch: { name?: string; description?: string },
): Promise<TeamRow | null> {
  const values: Partial<typeof team.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (Object.keys(values).length === 0) return getTeamById(teamId);
  const [row] = await db.update(team).set(values).where(eq(team.id, teamId)).returning();
  return row ? mapTeam(row) : null;
}

// Toggles whether the team is reachable through the MCP server. Owner-only at
// the route; the flag gates every MCP tool call scoped to this team.
export async function setTeamMcpEnabled(teamId: string, enabled: boolean): Promise<TeamRow | null> {
  const [row] = await db
    .update(team)
    .set({ mcpEnabled: enabled })
    .where(eq(team.id, teamId))
    .returning();
  return row ? mapTeam(row) : null;
}

// The team's feature toggles, read from the team row.
export function teamFeatures(row: TeamRow): TeamFeatures {
  return {
    projects: row.projectsEnabled,
  };
}

// Turns the optional sections on or off. Only the supplied ones change; a section
// that is turned off keeps its rows and shows again when it is turned back on.
export async function setTeamFeatures(
  teamId: string,
  patch: Partial<TeamFeatures>,
): Promise<TeamRow | null> {
  const values: Partial<typeof team.$inferInsert> = {};
  if (patch.projects !== undefined) values.projectsEnabled = patch.projects;
  if (Object.keys(values).length === 0) return getTeamById(teamId);
  const [row] = await db.update(team).set(values).where(eq(team.id, teamId)).returning();
  return row ? mapTeam(row) : null;
}

// Auto-archive thresholds for a team. Stored in team_setting under
// AUTO_ARCHIVE_KEY as { completedDays, canceledDays }. Each value is the number of
// days an issue may sit inactive in a completed/canceled column before the worker
// archives it; null disables archiving for that state group. A new team is
// created with DEFAULT_AUTO_ARCHIVE; a team with no stored row (created before
// this) keeps both null, so nothing is archived until an owner turns it on. The
// worker reads the same key and jsonb fields directly (apps/worker/src/store.ts) —
// keep them in sync.
const AUTO_ARCHIVE_KEY = 'auto_archive';

const DEFAULT_AUTO_ARCHIVE = { completedDays: 28, canceledDays: 7 };

export interface AutoArchiveSettings {
  completedDays: number | null;
  canceledDays: number | null;
}

// Coerces a stored/input value to a positive integer day count, or null (disabled)
// for anything else. Guards against non-integer or non-positive thresholds.
function normalizeDays(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function getAutoArchiveSettings(teamId: string): Promise<AutoArchiveSettings> {
  const stored = await getTeamSetting<Partial<AutoArchiveSettings>>(teamId, AUTO_ARCHIVE_KEY);
  return {
    completedDays: normalizeDays(stored?.completedDays),
    canceledDays: normalizeDays(stored?.canceledDays),
  };
}

export async function setAutoArchiveSettings(
  teamId: string,
  input: { completedDays?: number | null; canceledDays?: number | null },
): Promise<AutoArchiveSettings> {
  const next: AutoArchiveSettings = {
    completedDays: normalizeDays(input.completedDays),
    canceledDays: normalizeDays(input.canceledDays),
  };
  await setTeamSetting(teamId, AUTO_ARCHIVE_KEY, next);
  return next;
}

// Deletes a team and everything scoped to it. Every team-scoped foreign key
// has ON DELETE CASCADE on team_id, so deleting the team row removes its
// columns, issue types, labels, projects, issues, views, and
// actions, which in turn cascade to their own dependents (an issue's labels, field
// values/options, attachments, and activity; a custom field's values). The
// issue.state_id foreign key is NO ACTION, checked at end of statement — both the
// issues and their columns are deleted by the same cascade, so it is satisfied. The
// conversation threads of the team's agents are deleted first, since they live
// outside those cascades.
// Deletes the team. Projects whose only team it is go with it (their milestones,
// updates and label links cascade); projects shared with other teams only lose the
// link (project_team cascades).
export async function deleteTeam(teamId: string): Promise<void> {
  await deleteThreadsWhere({ teamId });
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM ${project} WHERE ${project.id} IN (
        SELECT ${projectTeam.projectId} FROM ${projectTeam}
        WHERE ${projectTeam.teamId} = ${teamId}
          AND NOT EXISTS (
            SELECT 1 FROM ${projectTeam} other
            WHERE other.project_id = ${projectTeam.projectId} AND other.team_id <> ${teamId}
          )
      )`);
    await tx.delete(team).where(eq(team.id, teamId));
  });
}

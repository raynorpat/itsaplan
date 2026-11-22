import { db, project, projectTeam, team, workflowState, teamMember, teamSetting } from '@repo/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { iso } from '../shared/lib';
import { atLeast, visibleTeamIds, workspaceRole } from '../shared/access';
import { getTeamSetting, setTeamSetting } from '../settings/store';

// Data access for teams: the top-level container that groups its own columns,
// labels, assignees, issues and saved views. Access is by membership (team_member): the creator becomes an
// "owner" and only members can reach a team's entities.

export interface TeamRow {
  id: string;
  key: string;
  name: string;
  description: string;
  // Linear's team visibility: public teams are open to the workspace's owners,
  // admins and members; private teams to their members only.
  visibility: 'public' | 'private';
  createdAt: string;
}

// A team in the caller's list, with the caller's membership in it (null when they
// see a public team they have not joined) and whether they manage it. The web app
// gates its UI off these; the API still enforces access on every request.
export interface TeamListItem extends TeamRow {
  role: 'owner' | 'member' | null;
  canManage: boolean;
}

function mapTeam(row: typeof team.$inferSelect): TeamRow {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    visibility: row.visibility === 'private' ? 'private' : 'public',
    createdAt: iso(row.createdAt),
  };
}

// The teams the user can see, ordered by key: their teams, plus every public team
// unless they are a guest.
export async function listTeams(userId: string): Promise<TeamListItem[]> {
  const visible = inArray(team.id, visibleTeamIds(userId));
  const isAdmin = atLeast(await workspaceRole(userId), 'admin');
  // canManageTeam for every row in one query: an admin manages every team, a member
  // a team they own or one without owners.
  const rows = await db
    .select({
      team,
      owner: teamMember.owner,
      hasOwners: sql<boolean>`EXISTS (SELECT 1 FROM team_member o WHERE o.team_id = ${team.id} AND o.owner)`,
    })
    .from(team)
    .leftJoin(teamMember, and(eq(teamMember.teamId, team.id), eq(teamMember.userId, userId)))
    .where(visible)
    .orderBy(team.key);
  return rows.map((r) => ({
    ...mapTeam(r.team),
    role: r.owner == null ? null : r.owner ? ('owner' as const) : ('member' as const),
    canManage: isAdmin || (r.owner != null && (r.owner || !r.hasOwners)),
  }));
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

export async function createTeam(
  input: {
    key: string;
    name: string;
    description?: string;
    visibility?: 'public' | 'private';
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
        visibility: input.visibility ?? 'public',
      })
      .returning();
    // Linear: whoever creates a team owns it.
    await tx.insert(teamMember).values({ teamId: row.id, userId: ownerId, owner: true });
    for (const [position, column] of DEFAULT_COLUMNS.entries()) {
      await tx.insert(workflowState).values({
        teamId: row.id,
        name: column.name,
        stateType: column.stateType,
        color: column.color,
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
  patch: { name?: string; description?: string; visibility?: 'public' | 'private' },
): Promise<TeamRow | null> {
  const values: Partial<typeof team.$inferInsert> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.visibility !== undefined) values.visibility = patch.visibility;
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
// states, labels, issues and views, which in turn cascade to their own dependents
// (an issue's labels, attachments and activity). The issue.state_id foreign key is
// NO ACTION, checked at end of statement — both the issues and their states are
// deleted by the same cascade, so it is satisfied.
// Deletes the team. Projects whose only team it is go with it (their milestones,
// updates and label links cascade); projects shared with other teams only lose the
// link (project_team cascades).
export async function deleteTeam(teamId: string): Promise<void> {
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

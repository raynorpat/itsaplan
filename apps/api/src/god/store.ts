import {
  db,
  user,
  session,
  account,
  projectTeam,
  issue,
  feedEntry,
  team,
  teamMember,
  teamView,
} from '@repo/db';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { iso } from '../shared/lib';

// Data access for the instance directories (god mode): every account and every
// team on this instance. It reads across the better-auth tables (user, session,
// account) and across teams the caller is not a member of, which no
// team-scoped store may do — every function here is behind the god guard.

export interface InstanceUserRow {
  id: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  // The workspace role: owner, admin, member or guest.
  role: string;
  // The sign-in methods linked to the account ("credential", "google", …).
  providers: string[];
  teamCount: number;
  // The start of the most recent session, or null when the user never signed in.
  lastSeenAt: string | null;
  createdAt: string;
}

// A team the user can reach, with the access their membership resolves to.
export interface InstanceUserTeam {
  teamId: string;
  teamKey: string;
  teamName: string;
  // Whether the user is a team owner.
  role: 'owner' | 'member';
  // How many owners the team has.
  ownerCount: number;
  joinedAt: string;
}

export interface InstanceUserDetail extends InstanceUserRow {
  teams: InstanceUserTeam[];
}

type UserRow = typeof user.$inferSelect;

// The per-user facts that live in other tables. Collected in one grouped query
// each and joined in memory, so the user query stays a plain select.
interface UserFacts {
  providers: Map<string, string[]>;
  teamCounts: Map<string, number>;
  lastSeen: Map<string, Date>;
}

async function loadUserFacts(userIds: string[]): Promise<UserFacts> {
  if (userIds.length === 0) {
    return {
      providers: new Map(),
      teamCounts: new Map(),
      lastSeen: new Map(),
    };
  }
  const [accountRows, memberRows, sessionRows] = await Promise.all([
    db
      .select({ userId: account.userId, providerId: account.providerId })
      .from(account)
      .where(inArray(account.userId, userIds)),
    db
      .select({ userId: teamMember.userId, count: sql<number>`count(*)::int` })
      .from(teamMember)
      .where(inArray(teamMember.userId, userIds))
      .groupBy(teamMember.userId),
    // Session start times, reduced to the latest per user below. Aggregating in
    // SQL would return the max as a driver-formatted string, not a Date.
    db
      .select({ userId: session.userId, createdAt: session.createdAt })
      .from(session)
      .where(inArray(session.userId, userIds)),
  ]);

  const providers = new Map<string, string[]>();
  for (const r of accountRows) {
    const list = providers.get(r.userId) ?? [];
    if (!list.includes(r.providerId)) list.push(r.providerId);
    providers.set(r.userId, list);
  }

  const lastSeen = new Map<string, Date>();
  for (const r of sessionRows) {
    const current = lastSeen.get(r.userId);
    if (!current || r.createdAt > current) lastSeen.set(r.userId, r.createdAt);
  }

  return {
    providers,
    teamCounts: new Map(memberRows.map((r) => [r.userId, r.count])),
    lastSeen,
  };
}

function toRow(r: UserRow, facts: UserFacts): InstanceUserRow {
  const lastSeen = facts.lastSeen.get(r.id) ?? null;
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    image: r.image,
    emailVerified: r.emailVerified,
    role: r.workspaceRole,
    providers: facts.providers.get(r.id) ?? [],
    teamCount: facts.teamCounts.get(r.id) ?? 0,
    lastSeenAt: lastSeen ? iso(lastSeen) : null,
    createdAt: iso(r.createdAt),
  };
}

export interface InstanceUserPage {
  items: InstanceUserRow[];
  // How many accounts match the filters, ignoring the page window.
  total: number;
}

// One page of accounts, newest first. `search` matches the name or the email; it
// runs in SQL, so the page window and the total count agree.
export async function listInstanceUsers(options: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<InstanceUserPage> {
  const term = options.search?.trim();
  const where = term
    ? or(ilike(user.name, `%${term}%`), ilike(user.email, `%${term}%`))
    : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(user)
      .where(where)
      .orderBy(desc(user.createdAt))
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(where),
  ]);

  const facts = await loadUserFacts(rows.map((r) => r.id));
  return { items: rows.map((r) => toRow(r, facts)), total: totals[0]?.count ?? 0 };
}

// One account with the teams it can reach. Returns null for an unknown id.
export async function getInstanceUser(userId: string): Promise<InstanceUserDetail | null> {
  const rows = await db.select().from(user).where(eq(user.id, userId));
  const row = rows[0];
  if (!row) return null;

  const [facts, memberships] = await Promise.all([
    loadUserFacts([row.id]),
    db
      .select({
        teamId: team.id,
        teamKey: team.key,
        teamName: team.name,
        owner: teamMember.owner,
        joinedAt: teamMember.createdAt,
      })
      .from(teamMember)
      .innerJoin(team, eq(team.id, teamMember.teamId))
      .where(eq(teamMember.userId, userId))
      .orderBy(team.name),
  ]);

  const ownerCounts = await countOwnersByTeam(memberships.map((m) => m.teamId));

  const teams: InstanceUserTeam[] = memberships.map((m) => {
    const role = m.owner ? 'owner' : 'member';
    return {
      teamId: m.teamId,
      teamKey: m.teamKey,
      teamName: m.teamName,
      role,
      ownerCount: ownerCounts.get(m.teamId) ?? 0,
      joinedAt: iso(m.joinedAt),
    };
  });

  return { ...toRow(row, facts), teams };
}

// How many owners each of the given teams has, keyed by team id.
async function countOwnersByTeam(teamIds: string[]): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db
    .select({ teamId: teamMember.teamId, count: sql<number>`count(*)::int` })
    .from(teamMember)
    .where(and(eq(teamMember.owner, true), inArray(teamMember.teamId, teamIds)))
    .groupBy(teamMember.teamId);
  return new Map(rows.map((r) => [r.teamId, r.count]));
}

// Removes the account. Every table that points at a user either cascades (its
// sessions, accounts, memberships, notifications, preferences) or sets the
// reference to null (assignee, activity actor, invites), so this is a single
// delete.
export async function deleteInstanceUser(userId: string): Promise<void> {
  await db.delete(user).where(eq(user.id, userId));
}

// ── Team directory ────────────────────────────────────────────────────────

// What a team holds, counted across its dependent tables. Read for the list and
// the detail alike, so a row in the directory already carries everything.
export interface InstanceTeamCounts {
  memberCount: number;
  issueCount: number;
  archivedIssueCount: number;
  projectCount: number;
  viewCount: number;
}

export interface InstanceTeamRow extends InstanceTeamCounts {
  id: string;
  key: string;
  name: string;
  description: string;
  mcpEnabled: boolean;
  // The most recent entry in the team's issue feed, or null when nothing has
  // happened in it yet.
  lastActivityAt: string | null;
  createdAt: string;
}

// One member of the team, with the access their membership resolves to. The
// mirror of InstanceUserTeam: same facts, read from the team's side.
export interface InstanceTeamMember {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface InstanceTeamDetail extends InstanceTeamRow {
  members: InstanceTeamMember[];
}

export interface InstanceTeamPage {
  items: InstanceTeamRow[];
  // How many teams match the search, ignoring the page window.
  total: number;
}

// How many rows each of the given teams has in a team-scoped table.
async function countByTeam(
  table: PgTable,
  teamIdColumn: AnyPgColumn,
  teamIds: string[],
  extra?: SQL,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ teamId: teamIdColumn, count: sql<number>`count(*)::int` })
    .from(table)
    .where(and(inArray(teamIdColumn, teamIds), extra))
    .groupBy(teamIdColumn);
  return new Map(rows.map((r) => [r.teamId as string, r.count]));
}

type TeamFacts = InstanceTeamCounts & { lastActivityAt: string | null };

const EMPTY_FACTS: TeamFacts = {
  memberCount: 0,
  issueCount: 0,
  archivedIssueCount: 0,
  projectCount: 0,
  viewCount: 0,
  lastActivityAt: null,
};

// The counts and the last feed entry for the given teams, each in one grouped
// query and joined in memory, so the team query stays a plain select.
async function loadTeamFacts(teamIds: string[]): Promise<(id: string) => TeamFacts> {
  if (teamIds.length === 0) return () => EMPTY_FACTS;
  const counts = (map: Map<string, number>, id: string) => map.get(id) ?? 0;

  const [members, issues, archivedIssues, projects, views, activityRows] = await Promise.all([
    countByTeam(teamMember, teamMember.teamId, teamIds),
    countByTeam(issue, issue.teamId, teamIds, isNull(issue.archivedAt)),
    countByTeam(issue, issue.teamId, teamIds, isNotNull(issue.archivedAt)),
    countByTeam(projectTeam, projectTeam.teamId, teamIds),
    countByTeam(teamView, teamView.teamId, teamIds),
    // The feed has no team column of its own; it reaches one through its issue.
    // Reduced to the latest per team below, because aggregating in SQL would
    // return the max as a driver-formatted string, not a Date.
    db
      .select({ teamId: issue.teamId, createdAt: feedEntry.createdAt })
      .from(feedEntry)
      .innerJoin(issue, eq(issue.id, feedEntry.issueId))
      .where(inArray(issue.teamId, teamIds)),
  ]);

  const lastActivity = new Map<string, Date>();
  for (const r of activityRows) {
    const current = lastActivity.get(r.teamId);
    if (!current || r.createdAt > current) lastActivity.set(r.teamId, r.createdAt);
  }

  return (id: string): TeamFacts => {
    const activeAt = lastActivity.get(id);
    return {
      memberCount: counts(members, id),
      issueCount: counts(issues, id),
      archivedIssueCount: counts(archivedIssues, id),
      projectCount: counts(projects, id),
      viewCount: counts(views, id),
      lastActivityAt: activeAt ? iso(activeAt) : null,
    };
  };
}

type TeamRow = typeof team.$inferSelect;

function toTeamRow(r: TeamRow, facts: TeamFacts): InstanceTeamRow {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    mcpEnabled: r.mcpEnabled,
    createdAt: iso(r.createdAt),
    ...facts,
  };
}

// One page of teams, newest first. `search` matches the key or the name and runs
// in SQL, so the page window and the total count agree.
export async function listInstanceTeams(options: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<InstanceTeamPage> {
  const term = options.search?.trim();
  const where = term ? or(ilike(team.key, `%${term}%`), ilike(team.name, `%${term}%`)) : undefined;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(team)
      .where(where)
      .orderBy(desc(team.createdAt))
      .limit(options.limit)
      .offset(options.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(team)
      .where(where),
  ]);

  const facts = await loadTeamFacts(rows.map((r) => r.id));
  const items = rows.map((r) => toTeamRow(r, facts(r.id)));
  return { items, total: totals[0]?.count ?? 0 };
}

// One team with its members and the access each membership resolves to. Returns
// null for an unknown id.
export async function getInstanceTeam(teamId: string): Promise<InstanceTeamDetail | null> {
  const rows = await db.select().from(team).where(eq(team.id, teamId));
  const row = rows[0];
  if (!row) return null;

  const [facts, memberships] = await Promise.all([
    loadTeamFacts([row.id]),
    db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        owner: teamMember.owner,
        joinedAt: teamMember.createdAt,
      })
      .from(teamMember)
      .innerJoin(user, eq(user.id, teamMember.userId))
      .where(eq(teamMember.teamId, teamId))
      .orderBy(user.name),
  ]);

  const members: InstanceTeamMember[] = memberships.map((m) => {
    const role = m.owner ? 'owner' : 'member';
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      image: m.image,
      role,
      joinedAt: iso(m.joinedAt),
    };
  });

  return { ...toTeamRow(row, facts(row.id)), members };
}

// Marks the account's email address as confirmed and returns the updated user.
// Returns null for an unknown id.
export async function verifyInstanceUserEmail(userId: string): Promise<InstanceUserDetail | null> {
  const updated = await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.id, userId))
    .returning({ id: user.id });
  if (updated.length === 0) return null;
  return getInstanceUser(userId);
}

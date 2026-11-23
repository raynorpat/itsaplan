import type { MemberRole, MemberRow } from '@/types/team';
import type { WorkspaceRole } from '@/types/workspace';

// Linear's role flags on a user: owner and admin both set for an owner, neither nor
// guest for a member.
export function roleFromFlags(flags: {
  owner: boolean;
  admin: boolean;
  guest: boolean;
}): WorkspaceRole {
  if (flags.owner) return 'owner';
  if (flags.admin) return 'admin';
  if (flags.guest) return 'guest';
  return 'member';
}

type UserNode = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  createdAt: string;
  active: boolean;
  owner: boolean;
  admin: boolean;
  guest: boolean;
};

export function toWorkspaceUser(node: UserNode): WorkspaceUser {
  return {
    userId: node.id,
    name: node.name,
    email: node.email,
    image: node.avatarUrl ?? null,
    role: roleFromFlags(node),
    suspended: !node.active,
    createdAt: node.createdAt,
  };
}

type MembershipNode = {
  id: string;
  owner: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; avatarUrl?: string | null };
};

export function toMemberRows(teamId: string, nodes: MembershipNode[]): MemberRow[] {
  return nodes.map((m) => ({
    membershipId: m.id,
    teamId,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.avatarUrl ?? null,
    role: m.owner ? 'owner' : 'member',
    createdAt: m.createdAt,
  }));
}

export const membershipOf = (rows: MemberRow[], userId: string) =>
  rows.find((r) => r.userId === userId) ?? null;

type Viewer = { id: string; admin: boolean; owner: boolean; guest: boolean };

// The viewer's access to a team as project 2 defines it: workspace admins and owners
// manage every team they can see; otherwise a member manages a team they own, or any
// team without owners. `memberships` must contain the viewer's own membership when
// there is one, and every owner when the result depends on them (needsTeamOwners).
export function teamAccess(
  viewer: Viewer,
  memberships: { userId: string; owner: boolean }[],
): { role: MemberRole | null; workspaceRole: WorkspaceRole; canManage: boolean } {
  const workspaceRole = roleFromFlags(viewer);
  const mine = memberships.find((m) => m.userId === viewer.id);
  const role: MemberRole | null = mine ? (mine.owner ? 'owner' : 'member') : null;
  const hasOwners = memberships.some((m) => m.owner);
  const canManage =
    workspaceRole === 'owner' ||
    workspaceRole === 'admin' ||
    (!!mine && (mine.owner || !hasOwners));
  return { role, workspaceRole, canManage };
}

// Whether the team's owners decide the viewer's manage right: only for a plain
// member of the team who is not a workspace admin or owner.
export function needsTeamOwners(viewer: Viewer, mine: { owner: boolean } | null): boolean {
  return !!mine && !mine.owner && !viewer.admin && !viewer.owner;
}

// A user of the workspace, as owners and admins manage them.
export interface WorkspaceUser {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: WorkspaceRole;
  // Suspension is Linear's way to remove someone.
  suspended: boolean;
  createdAt: string;
}

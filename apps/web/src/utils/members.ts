import type { MemberRow, WorkspaceRole, WorkspaceUser } from '@/lib/api';

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

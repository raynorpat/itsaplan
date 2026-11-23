import type { WorkspaceRole } from '@/lib/api';

// Linear's workspace roles, lowest first. Used to gate UI; the API enforces the
// same rules on every request.
const RANK: Record<WorkspaceRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };

export const WORKSPACE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

// Reads the session user's role; an unknown or missing value counts as a guest.
export function toWorkspaceRole(value: unknown): WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'guest'
    ? value
    : 'guest';
}

export const atLeast = (role: WorkspaceRole, minimum: WorkspaceRole) => RANK[role] >= RANK[minimum];

// Owners and admins administer the workspace (settings, webhooks, users).
export const isWorkspaceAdmin = (role: WorkspaceRole) => atLeast(role, 'admin');

// The roles `actor` may give or take away for `target`: admins act on members and
// guests up to admin; owners on anyone, including making owners.
export function assignableRoles(actor: WorkspaceRole, target: WorkspaceRole): WorkspaceRole[] {
  if (actor === 'owner') return WORKSPACE_ROLES;
  if (actor === 'admin' && !atLeast(target, 'admin')) return ['admin', 'member', 'guest'];
  return [];
}

// The roles `actor` may invite with (never above their own; owners are made later).
export function invitableRoles(actor: WorkspaceRole): Array<'admin' | 'member' | 'guest'> {
  if (atLeast(actor, 'admin')) return ['admin', 'member', 'guest'];
  if (actor === 'member') return ['member', 'guest'];
  return [];
}

// Owners, admins and members see initiatives; Linear's guests have none. An unknown
// role (the team is not loaded yet) shows none.
export const canSeeInitiatives = (role: WorkspaceRole | null) =>
  role != null && atLeast(role, 'member');

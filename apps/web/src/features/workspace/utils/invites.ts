import type { InviteRow } from '@/lib/api';
import { inviteRoleFromLinear } from '@/utils/workspaceRoles';

type InviteNode = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt?: string | null;
  metadata?: unknown;
  inviter?: { id: string; name: string } | null;
};

// The API puts the invite's teams in `metadata.teamIds`, and the link token in
// `metadata.token` only for the invite's sender and for admins and owners.
export function toInviteRow(node: InviteNode): InviteRow {
  const meta = (node.metadata && typeof node.metadata === 'object' ? node.metadata : {}) as {
    token?: unknown;
    teamIds?: unknown;
  };
  return {
    id: node.id,
    token: typeof meta.token === 'string' ? meta.token : null,
    email: node.email,
    role: inviteRoleFromLinear(node.role),
    teamIds: Array.isArray(meta.teamIds) ? meta.teamIds.map(String) : [],
    createdAt: node.createdAt,
    expiresAt: node.expiresAt ?? node.createdAt,
    invitedByUserId: node.inviter?.id ?? null,
    invitedByName: node.inviter?.name ?? null,
  };
}

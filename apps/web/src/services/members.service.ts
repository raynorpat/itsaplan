import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type MemberRole } from '@/lib/api';
import { qk } from '@/services/queryKeys';

export function useMembersQuery(teamKey: string | null) {
  return useQuery({
    queryKey: qk.members(teamKey ?? ''),
    queryFn: () => api.listMembers(teamKey!),
    enabled: teamKey != null,
  });
}

export function useRemoveMember(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(teamKey, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(teamKey) }),
  });
}

// Set a member's role (owner-only on the API). role 'owner' promotes to owner;
// role 'member' assigns a custom role by roleId (null resets to the default role).
export function useSetMemberRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      userId,
      role,
      roleId,
    }: {
      userId: string;
      role: MemberRole;
      roleId?: string | null;
    }) => api.setMemberRole(teamKey, userId, { role, roleId }),
    onSuccess: (_data, { role }) => {
      qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      toast.success(role === 'owner' ? 'Member promoted to owner' : 'Member role updated');
    },
  });
}

// Set what a member does in the team (owner-only on the API).
export function useSetMemberDescription(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, description }: { userId: string; description: string }) =>
      api.setMemberDescription(teamKey, userId, description),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      toast.success('Member description updated');
    },
  });
}

// Invites are owner-only on the API; pass enabled=false for a non-owner so the
// list query does not fire a request that would 403.
export function useInvitesQuery(teamKey: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.invites(teamKey ?? ''),
    queryFn: () => api.listInvites(teamKey!),
    enabled: teamKey != null && enabled,
  });
}

export function useCreateInvite(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: MemberRole; roleId?: string | null }) =>
      api.createInvite(teamKey, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(teamKey) }),
  });
}

export function useDeleteInvite(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.deleteInvite(teamKey, inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites(teamKey) }),
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type InviteRole, type WorkspaceRole } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// Pending workspace invites. Guests cannot list them; pass enabled=false for a
// guest so the query does not fire a request that would 403.
export function useInvitesQuery(enabled = true) {
  return useQuery({ queryKey: qk.invites, queryFn: () => api.listInvites(), enabled });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: InviteRole; teamIds: string[] }) =>
      api.createInvite(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.invites });
      toast.success('Invite created');
    },
  });
}

export function useDeleteInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => api.deleteInvite(inviteId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.invites }),
  });
}

export function useSetWorkspaceRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
      api.setWorkspaceRole(userId, role),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.workspaceUsers });
      toast.success('Role updated');
    },
  });
}

// Suspend or unsuspend a user (Linear's way to remove someone from the workspace).
export function useSetSuspended() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, suspended }: { userId: string; suspended: boolean }) =>
      suspended ? api.suspendUser(userId) : api.unsuspendUser(userId),
    onSuccess: (_data, { suspended }) => {
      void qc.invalidateQueries({ queryKey: qk.workspaceUsers });
      toast.success(suspended ? 'User suspended' : 'User unsuspended');
    },
  });
}

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

// Add a workspace user to the team (any member of a public team; a team manager of
// a private one).
export function useAddMember(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.addMember(teamKey, { userId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      toast.success('Member added');
    },
  });
}

export function useRemoveMember(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(teamKey, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.members(teamKey) }),
  });
}

// Make a member a team owner, or back to a plain member (team managers).
export function useSetMemberRole(teamKey: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      api.setMemberRole(teamKey, userId, role),
    onSuccess: (_data, { role }) => {
      void qc.invalidateQueries({ queryKey: qk.members(teamKey) });
      void qc.invalidateQueries({ queryKey: qk.team(teamKey) });
      toast.success(role === 'owner' ? 'Member made a team owner' : 'Team owner removed');
    },
  });
}

// The workspace's users. Guests cannot list them; pass enabled=false for a guest so
// the query does not fire a request that would 403.
export function useWorkspaceUsersQuery(enabled = true) {
  return useQuery({
    queryKey: qk.workspaceUsers,
    queryFn: () => api.listWorkspaceUsers(),
    enabled,
  });
}

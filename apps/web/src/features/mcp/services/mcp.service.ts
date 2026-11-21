import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// The current state lives on the team payload (getTeam), so there is no read
// query here: this writes and invalidates the team.
export function useUpdateTeamMcp(teamKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.updateTeamSettings(teamKey, { mcpEnabled: enabled }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: qk.team(teamKey) });
      toast.success(data.mcpEnabled ? 'MCP enabled for this team' : 'MCP disabled for this team');
    },
  });
}

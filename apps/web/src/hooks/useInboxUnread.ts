import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/services/queryKeys';

// A team's unread notification count, for the sidebar badge and the inbox
// header. Reads the count the inbox list returns, asking for one row; React Query
// pauses the interval while the tab is in the background. Lives in the shared layer so both the sidebar and the inbox
// feature can use it.
export function useInboxUnread(teamKey: string | null, teamId: string | null) {
  return useQuery({
    queryKey: qk.notificationsUnread(teamKey ?? ''),
    queryFn: () => api.listNotifications(teamId as string, { limit: 1 }),
    enabled: teamKey != null && teamId != null,
    refetchInterval: 15000,
    select: (d) => d.unread,
  });
}

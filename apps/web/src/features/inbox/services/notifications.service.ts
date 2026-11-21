import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type NotificationCursor,
  type NotificationFilters,
  type NotificationDeleteScope,
} from '@/lib/api';
import { qk } from '@/services/queryKeys';

// One team's inbox, keyset-paged and scoped by the active filters. The filters
// object is part of the query key so switching filters is a distinct cache entry.
export function useNotificationsQuery(
  teamKey: string,
  teamId: string,
  filters: NotificationFilters,
) {
  return useInfiniteQuery({
    queryKey: qk.notifications(teamKey, filters),
    queryFn: ({ pageParam }) =>
      api.listNotifications(teamId, { cursor: pageParam, limit: 30, filters }),
    initialPageParam: null as NotificationCursor | null,
    getNextPageParam: (last) => last.nextCursor,
  });
}

function useInvalidateInbox(teamKey: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['notifications', teamKey] });
    void qc.invalidateQueries({ queryKey: qk.notificationsUnread(teamKey) });
  };
}

export function useSetNotificationRead(teamKey: string) {
  const invalidate = useInvalidateInbox(teamKey);
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => api.setNotificationRead(id, read),
    onSuccess: invalidate,
  });
}

export function useMarkAllRead(teamKey: string, teamId: string) {
  const invalidate = useInvalidateInbox(teamKey);
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(teamId),
    onSuccess: invalidate,
  });
}

export function useSnoozeNotification(teamKey: string) {
  const invalidate = useInvalidateInbox(teamKey);
  return useMutation({
    mutationFn: ({ id, until }: { id: string; until: string | null }) =>
      api.snoozeNotification(id, until),
    onSuccess: invalidate,
  });
}

export function useDeleteNotification(teamKey: string) {
  const invalidate = useInvalidateInbox(teamKey);
  return useMutation({
    mutationFn: (id: string) => api.deleteNotification(id),
    onSuccess: invalidate,
  });
}

export function useDeleteNotifications(teamKey: string, teamId: string) {
  const invalidate = useInvalidateInbox(teamKey);
  return useMutation({
    mutationFn: (scope: NotificationDeleteScope) => api.deleteNotifications(scope, teamId),
    onSuccess: invalidate,
  });
}

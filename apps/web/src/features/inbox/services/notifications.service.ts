import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Notification } from '@/lib/api';
import { graphql, gqlRequest } from '@/lib/graphql';
import { mergeChanged } from '@/utils/mergeChanged';
import { runBulk } from '@/utils/bulk';
import { qk } from '@/services/queryKeys';
import { NotificationFields, toNotifications } from '@/services/notifications.service';

// The inbox's writes. Each changes some of the viewer's notifications: the change
// shows at once, the notifications the server returns replace the cached rows, and a
// refused change is put back and reported.

const UpdateNotification = graphql(
  `
    mutation InboxUpdateNotification($id: String!, $input: NotificationUpdateInput!) {
      notificationUpdate(id: $id, input: $input) {
        notification {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

const UnarchiveNotification = graphql(
  `
    mutation InboxUnarchiveNotification($id: String!) {
      notificationUnarchive(id: $id) {
        entity {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

const MarkReadAll = graphql(
  `
    mutation InboxMarkReadAll($input: NotificationEntityInput!, $readAt: DateTime!) {
      notificationMarkReadAll(input: $input, readAt: $readAt) {
        notifications {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

const MarkUnreadAll = graphql(
  `
    mutation InboxMarkUnreadAll($input: NotificationEntityInput!) {
      notificationMarkUnreadAll(input: $input) {
        notifications {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

const SnoozeAll = graphql(
  `
    mutation InboxSnoozeAll($input: NotificationEntityInput!, $snoozedUntilAt: DateTime!) {
      notificationSnoozeAll(input: $input, snoozedUntilAt: $snoozedUntilAt) {
        notifications {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

const ArchiveAll = graphql(
  `
    mutation InboxArchiveAll($input: NotificationEntityInput!) {
      notificationArchiveAll(input: $input) {
        notifications {
          ...NotificationFields
        }
      }
    }
  `,
  [NotificationFields],
);

// What one action does to a notification, shown before the server answers.
export type InboxChange =
  | { kind: 'read'; read: boolean }
  | { kind: 'snooze'; until: string | null }
  | { kind: 'archive' }
  | { kind: 'unarchive' };

function applyLocally(n: Notification, change: InboxChange, now: string): Notification {
  switch (change.kind) {
    case 'read':
      return { ...n, readAt: change.read ? (n.readAt ?? now) : null };
    case 'snooze':
      return { ...n, snoozedUntil: change.until };
    case 'archive':
      return { ...n, archivedAt: n.archivedAt ?? now };
    case 'unarchive':
      return { ...n, archivedAt: null };
  }
}

// One notification, by id. Bulk actions on a selection use the *All mutations with
// the notification's id, as Linear's NotificationEntityInput takes.
async function runOne(id: string, change: InboxChange, now: string): Promise<Notification[]> {
  const input = { id };
  switch (change.kind) {
    case 'read': {
      if (change.read) {
        const data = await gqlRequest(MarkReadAll, { input, readAt: now });
        return toNotifications(data.notificationMarkReadAll.notifications);
      }
      const data = await gqlRequest(MarkUnreadAll, { input });
      return toNotifications(data.notificationMarkUnreadAll.notifications);
    }
    case 'snooze': {
      if (change.until == null) {
        const data = await gqlRequest(UpdateNotification, { id, input: { snoozedUntilAt: null } });
        return toNotifications([data.notificationUpdate.notification]);
      }
      const data = await gqlRequest(SnoozeAll, { input, snoozedUntilAt: change.until });
      return toNotifications(data.notificationSnoozeAll.notifications);
    }
    case 'archive': {
      const data = await gqlRequest(ArchiveAll, { input });
      return toNotifications(data.notificationArchiveAll.notifications);
    }
    case 'unarchive': {
      const data = await gqlRequest(UnarchiveNotification, { id });
      return data.notificationUnarchive.entity
        ? toNotifications([data.notificationUnarchive.entity])
        : [];
    }
  }
}

const describeFailure = (change: InboxChange, count: number) => {
  const what = count === 1 ? 'notification' : `${count} notifications`;
  switch (change.kind) {
    case 'read':
      return `Could not mark the ${what} as ${change.read ? 'read' : 'unread'}.`;
    case 'snooze':
      return `Could not ${change.until ? 'snooze' : 'unsnooze'} the ${what}.`;
    case 'archive':
      return `Could not archive the ${what}.`;
    case 'unarchive':
      return `Could not restore the ${what}.`;
  }
};

// Applies one change to the given notifications. A refused notification goes back
// to how it was and one toast says how many were refused.
export function useChangeNotifications() {
  const qc = useQueryClient();
  const key = qk.notifications();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async ({ ids, change }: { ids: string[]; change: InboxChange }) => {
      const now = new Date().toISOString();
      const returned: Notification[] = [];
      const result = await runBulk(ids, {
        size: 1,
        runOne: async (id) => {
          returned.push(...(await runOne(id, change, now)));
        },
      });
      return { result, returned };
    },
    onMutate: async ({ ids, change }) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const before = qc.getQueryData<Notification[]>(key);
      const now = new Date().toISOString();
      const set = new Set(ids);
      qc.setQueryData<Notification[]>(key, (list) =>
        list?.map((n) => (set.has(n.id) ? applyLocally(n, change, now) : n)),
      );
      return { before };
    },
    onSuccess: ({ result, returned }, { change }, ctx) => {
      qc.setQueryData<Notification[]>(key, (list) => {
        if (!list) return list;
        let next = mergeChanged(list, returned, (n) => n.updatedAt);
        if (result.failed.length > 0 && ctx?.before) {
          const failed = new Set(result.failed.map((f) => f.id));
          const original = new Map(ctx.before.map((n) => [n.id, n]));
          next = next.map((n) => (failed.has(n.id) ? (original.get(n.id) ?? n) : n));
        }
        return next;
      });
      if (result.failed.length > 0) toast.error(describeFailure(change, result.failed.length));
    },
    onError: (_err, { ids, change }, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(describeFailure(change, ids.length));
    },
  });
}

// "Mark all as read": the issues with unread notifications, one call per issue
// (notificationMarkReadAll takes one issue at a time).
export function useMarkIssuesRead() {
  const qc = useQueryClient();
  const key = qk.notifications();
  return useMutation({
    meta: { suppressErrorToast: true },
    mutationFn: async (issueIds: string[]) => {
      const readAt = new Date().toISOString();
      const returned: Notification[] = [];
      const result = await runBulk(issueIds, {
        size: 1,
        runOne: async (issueId) => {
          const data = await gqlRequest(MarkReadAll, { input: { issueId }, readAt });
          returned.push(...toNotifications(data.notificationMarkReadAll.notifications));
        },
      });
      return { result, returned };
    },
    onSuccess: ({ result, returned }) => {
      qc.setQueryData<Notification[]>(key, (list) =>
        list ? mergeChanged(list, returned, (n) => n.updatedAt) : list,
      );
      if (result.failed.length > 0)
        toast.error(`Could not mark the notifications of ${result.failed.length} issues as read.`);
    },
    onError: () => toast.error('Could not mark the notifications as read.'),
  });
}

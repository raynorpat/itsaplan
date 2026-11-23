import { useMemo } from 'react';
import type { Notification, NotificationType, StateType } from '@/lib/api';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { useChangedSince } from '@/hooks/useChangedSince';
import { useSnoozeClock } from '@/hooks/useSnoozeClock';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { unreadCount } from '@/utils/notifications';
import { qk } from '@/services/queryKeys';

// The viewer's notifications for the whole workspace (Linear has one inbox, not one
// per team). The list holds every unarchived notification, loaded in pages, and the
// inbox and the sidebar badge both read it. Lives in the shared layer because the
// sidebar uses it.

export const NotificationFields = graphql(`
  fragment NotificationFields on Notification {
    id
    type
    readAt
    snoozedUntilAt
    archivedAt
    createdAt
    updatedAt
    actor {
      id
      name
    }
    ... on IssueNotification {
      issueId
      issue {
        id
        number
        title
        state {
          type
        }
      }
      team {
        id
        key
        name
      }
    }
  }
`);

// Linear's notification type names, as the API serves the four kinds it records.
const TYPES: Record<string, NotificationType> = {
  issueAssignedToYou: 'assigned',
  issueCommentMention: 'mentioned',
  issueNewComment: 'commented',
  issueStatusChanged: 'state_changed',
};

// The web's notification row, or null for a kind the inbox does not show.
export function toNotification(data: FragmentOf<typeof NotificationFields>): Notification | null {
  const node = readFragment(NotificationFields, data);
  const type = TYPES[node.type];
  if (!type || !('issue' in node) || !node.issue || !node.team) return null;
  return {
    id: node.id,
    type,
    actorUserId: node.actor?.id ?? null,
    actorName: node.actor?.name ?? null,
    readAt: node.readAt ?? null,
    snoozedUntil: node.snoozedUntilAt ?? null,
    archivedAt: node.archivedAt ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    issueId: node.issueId,
    issueSeq: node.issue.number,
    issueTitle: node.issue.title,
    issueStateType: node.issue.state.type as StateType,
    teamId: node.team.id,
    teamKey: node.team.key,
    teamName: node.team.name,
  };
}

export const toNotifications = (nodes: FragmentOf<typeof NotificationFields>[]) =>
  nodes.map(toNotification).filter((n): n is Notification => n != null);

const NotificationsPage = graphql(
  `
    query InboxNotifications(
      $filter: NotificationFilter
      $includeArchived: Boolean
      $after: String
      $first: Int
    ) {
      notifications(
        filter: $filter
        includeArchived: $includeArchived
        after: $after
        first: $first
      ) {
        nodes {
          ...NotificationFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  [NotificationFields],
);

async function fetchNotifications(
  filter: Record<string, unknown> | undefined,
  includeArchived: boolean,
): Promise<Notification[]> {
  const nodes = await fetchAllPages(async (after, first) => {
    const data = await gqlRequest(NotificationsPage, { filter, includeArchived, after, first });
    return data.notifications;
  });
  return toNotifications(nodes);
}

// Every unarchived notification of the viewer, kept fresh by changed-since polling.
// The changed-since query includes archived ones, so a notification archived
// elsewhere arrives with its archivedAt set and the inbox stops showing it.
export function useNotificationsList() {
  return useChangedSince<Notification>({
    queryKey: qk.notifications(),
    fetchAll: () => fetchNotifications(undefined, false),
    fetchChanged: (since) => fetchNotifications({ updatedAt: { gt: since } }, true),
    getUpdatedAt: (n) => n.updatedAt,
  });
}

// The inbox badge: unread, unsnoozed, unarchived notifications in the loaded list.
export function useInboxUnread(): number {
  const { data } = useNotificationsList();
  const now = useSnoozeClock(data);
  return useMemo(() => (data ? unreadCount(data, now) : 0), [data, now]);
}

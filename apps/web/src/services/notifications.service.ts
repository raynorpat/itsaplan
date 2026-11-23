import { useMemo } from 'react';
import type { Notification, NotificationType } from '@/types/notification';
import type { StateType } from '@/types/team';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { useChangedSince } from '@/hooks/useChangedSince';
import { useSnoozeClock } from '@/hooks/useSnoozeClock';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { unreadCount } from '@/utils/notifications';
import { agentNotificationType } from '@/utils/agentNotifications';
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
    ... on AgentSessionNotification {
      agentSessionId
    }
  }
`);

// The issue an agent session notification is about: AgentSessionNotification has no
// issue field, so the inbox reads it from the session.
const AgentSessionIssueQuery = graphql(`
  query InboxAgentSessionIssue($id: String!) {
    agentSession(id: $id) {
      id
      issue {
        id
        number
        title
        state {
          type
        }
        team {
          id
          key
          name
        }
      }
    }
  }
`);

interface NotificationIssue {
  id: string;
  number: number;
  title: string;
  state: { type: string };
  team: { id: string; key: string; name: string };
}

// Linear's notification type names, as the API serves the four kinds it records.
const TYPES: Record<string, NotificationType> = {
  issueAssignedToYou: 'assigned',
  issueCommentMention: 'mentioned',
  issueNewComment: 'commented',
  issueStatusChanged: 'state_changed',
};

// The web's notification row, or null for a kind the inbox does not show. An agent
// session notification takes its issue from `sessionIssues` (by session id).
export function toNotification(
  data: FragmentOf<typeof NotificationFields>,
  sessionIssues: Map<string, NotificationIssue | null> = new Map(),
): Notification | null {
  const node = readFragment(NotificationFields, data);
  const agentType = agentNotificationType(node.type);
  if (agentType && 'agentSessionId' in node) {
    const issue = sessionIssues.get(node.agentSessionId);
    if (!issue) return null;
    return {
      id: node.id,
      type: agentType,
      actorUserId: node.actor?.id ?? null,
      actorName: node.actor?.name ?? null,
      readAt: node.readAt ?? null,
      snoozedUntil: node.snoozedUntilAt ?? null,
      archivedAt: node.archivedAt ?? null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      issueId: issue.id,
      issueSeq: issue.number,
      issueTitle: issue.title,
      issueStateType: issue.state.type as StateType,
      teamId: issue.team.id,
      teamKey: issue.team.key,
      teamName: issue.team.name,
    };
  }
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

export const toNotifications = (
  nodes: FragmentOf<typeof NotificationFields>[],
  sessionIssues?: Map<string, NotificationIssue | null>,
) => nodes.map((n) => toNotification(n, sessionIssues)).filter((n): n is Notification => n != null);

// The issues of the agent sessions the notifications refer to, one request per
// session. A session the viewer can no longer read maps to null (not shown).
async function fetchSessionIssues(
  nodes: FragmentOf<typeof NotificationFields>[],
): Promise<Map<string, NotificationIssue | null>> {
  const ids = new Set<string>();
  for (const data of nodes) {
    const node = readFragment(NotificationFields, data);
    if ('agentSessionId' in node && node.agentSessionId) ids.add(node.agentSessionId);
  }
  const entries = await Promise.all(
    [...ids].map(async (id) => {
      try {
        const { agentSession } = await gqlRequest(AgentSessionIssueQuery, { id });
        return [id, agentSession.issue ?? null] as const;
      } catch {
        return [id, null] as const;
      }
    }),
  );
  return new Map(entries);
}

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
  return toNotifications(nodes, await fetchSessionIssues(nodes));
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

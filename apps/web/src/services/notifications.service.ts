import { useMemo } from 'react';
import type { Notification, NotificationType } from '@/types/notification';
import type { StateType } from '@/types/team';
import { chunk } from '@/utils/bulk';
import { graphql, gqlRequest, readFragment, type FragmentOf } from '@/lib/graphql';
import { useChangedSince } from '@/hooks/useChangedSince';
import { useSnoozeClock } from '@/hooks/useSnoozeClock';
import { fetchAllPages } from '@/utils/fetchAllPages';
import { unreadCount } from '@/utils/notifications';
import { agentNotificationType } from '@/utils/agentNotifications';
import { actorDisplay } from '@/utils/actorDisplay';
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
    botActor {
      type
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
      agentActivityId
    }
  }
`);

// The issue an agent session notification is about: AgentSessionNotification has no
// issue field, so the inbox reads it from the session, through the notification's
// activity (agentActivities takes an id filter; agentSessions takes none).
const AgentActivitySessionsQuery = graphql(`
  query InboxAgentActivitySessions($ids: [ID!]!, $first: Int) {
    agentActivities(filter: { id: { in: $ids } }, first: $first) {
      nodes {
        id
        agentSession {
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
  const who = actorDisplay(node);
  const actor = {
    actorUserId: node.actor?.id ?? null,
    actorName: who.kind === 'unknown' ? null : who.name,
    actorWorkflow: who.kind === 'workflow',
  };
  const agentType = agentNotificationType(node.type);
  if (agentType && 'agentSessionId' in node) {
    const issue = sessionIssues.get(node.agentSessionId);
    if (!issue) return null;
    return {
      id: node.id,
      type: agentType,
      ...actor,
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
    ...actor,
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

// The issues of the agent sessions the notifications refer to, by session id, in one
// request per 250 notifications. A session the viewer can no longer read is missing
// (the notification is not shown). A failed request fails the whole load, so the
// next refresh tries again rather than dropping the notifications.
async function fetchSessionIssues(
  nodes: FragmentOf<typeof NotificationFields>[],
): Promise<Map<string, NotificationIssue | null>> {
  const activityIds = new Set<string>();
  for (const data of nodes) {
    const node = readFragment(NotificationFields, data);
    if ('agentActivityId' in node && node.agentActivityId) activityIds.add(node.agentActivityId);
  }
  const issues = new Map<string, NotificationIssue | null>();
  for (const ids of chunk([...activityIds], 250)) {
    const { agentActivities } = await gqlRequest(AgentActivitySessionsQuery, {
      ids,
      first: ids.length,
    });
    for (const a of agentActivities.nodes)
      issues.set(a.agentSession.id, a.agentSession.issue ?? null);
  }
  return issues;
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

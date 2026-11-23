// An agent session on the issue page, over GraphQL: the session's status and links
// and its activities. Stop goes through the instance plugin (Linear's schema does
// not let an API client publish the stop signal).

import { useEffect, useRef } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { instanceFetch } from '@/lib/auth-client';
import { qk } from '@/services/queryKeys';
import {
  issueSessionStatus,
  pollDelay,
  type ActivityType,
  type AgentSessionStatus,
  type SessionActivity,
} from '../utils/agentSession';

const AgentSessionQuery = graphql(`
  query IssueAgentSession($id: String!) {
    agentSession(id: $id) {
      id
      status
      externalLinks {
        label
        url
      }
      appUser {
        id
        name
        avatarUrl
      }
      activities(first: 250) {
        nodes {
          id
          createdAt
          ephemeral
          signal
          sourceComment {
            id
          }
          user {
            name
          }
          content {
            __typename
            ... on AgentActivityThoughtContent {
              body
            }
            ... on AgentActivityActionContent {
              action
              parameter
              result
            }
            ... on AgentActivityElicitationContent {
              body
            }
            ... on AgentActivityResponseContent {
              body
            }
            ... on AgentActivityErrorContent {
              body
            }
            ... on AgentActivityPromptContent {
              body
            }
          }
        }
      }
    }
  }
`);

export interface AgentSessionView {
  id: string;
  status: AgentSessionStatus;
  links: { label: string; url: string }[];
  appName: string;
  appImage: string | null;
  activities: SessionActivity[];
}

const CONTENT_TYPE: Record<string, ActivityType> = {
  AgentActivityThoughtContent: 'thought',
  AgentActivityActionContent: 'action',
  AgentActivityElicitationContent: 'elicitation',
  AgentActivityResponseContent: 'response',
  AgentActivityErrorContent: 'error',
  AgentActivityPromptContent: 'prompt',
};

async function fetchSession(id: string): Promise<AgentSessionView> {
  const { agentSession: s } = await gqlRequest(AgentSessionQuery, { id });
  return {
    id: s.id,
    status: s.status as AgentSessionStatus,
    links: s.externalLinks.map((l) => ({ label: l.label, url: l.url })),
    appName: s.appUser.name,
    appImage: s.appUser.avatarUrl ?? null,
    activities: s.activities.nodes.flatMap((a) => {
      const c = a.content;
      const type = CONTENT_TYPE[c.__typename];
      if (!type) return [];
      return [
        {
          id: a.id,
          createdAt: String(a.createdAt),
          type,
          body: 'body' in c ? (c.body ?? null) : null,
          action: 'action' in c ? c.action : null,
          parameter: 'parameter' in c ? c.parameter : null,
          result: 'result' in c ? (c.result ?? null) : null,
          ephemeral: a.ephemeral,
          signal: a.signal ?? null,
          sourceCommentId: a.sourceComment?.id ?? null,
          userName: a.user.name,
        },
      ];
    }),
  };
}

// What makes a refresh count as a change: the status and the newest activity.
const signature = (s: AgentSessionView) => `${s.status}:${s.activities.at(-1)?.id ?? ''}`;

// A session view, refreshed every few seconds while the agent is expected to write.
// After ten minutes without a change it stops refreshing until the window is focused.
export function useAgentSession(issueId: string, sessionId: string) {
  const qc = useQueryClient();
  const last = useRef({ signature: '', at: Date.now() });
  useEffect(() => {
    const onFocus = () => {
      last.current.at = Date.now();
      void qc.invalidateQueries({ queryKey: qk.agentSession(issueId, sessionId) });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [qc, issueId, sessionId]);
  return useQuery({
    queryKey: qk.agentSession(issueId, sessionId),
    queryFn: () => fetchSession(sessionId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const now = Date.now();
      if (signature(data) !== last.current.signature)
        last.current = { signature: signature(data), at: now };
      return pollDelay(data.status, last.current.at, now);
    },
  });
}

// The status shown on the issue: its first open session's, from the session views the
// feed already loads (sessionIds newest first).
export function useIssueSessionStatus(
  issueId: string,
  sessionIds: string[],
): AgentSessionStatus | null {
  const results = useQueries({
    queries: sessionIds.map((id) => ({
      queryKey: qk.agentSession(issueId, id),
      queryFn: () => fetchSession(id),
    })),
  });
  return issueSessionStatus(results.flatMap((r) => (r.data ? [r.data.status] : [])));
}

export function useStopAgentSession(issueId: string, sessionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      instanceFetch('/instance/agent-session-stop', { method: 'POST', body: { sessionId } }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.agentSession(issueId, sessionId) }),
  });
}

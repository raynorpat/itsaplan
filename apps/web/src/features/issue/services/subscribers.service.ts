// An issue's subscribers and the viewer's subscribe toggle, over GraphQL. Subscribers
// receive the issue's comment and status-change notifications.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';

const IssueSubscribersQuery = graphql(`
  query IssueSubscribers($id: String!) {
    issue(id: $id) {
      id
      subscribers(first: 250) {
        nodes {
          id
          name
          avatarUrl
        }
      }
    }
  }
`);

const IssueSubscribe = graphql(`
  mutation IssueSubscribe($id: String!) {
    issueSubscribe(id: $id) {
      success
    }
  }
`);

const IssueUnsubscribe = graphql(`
  mutation IssueUnsubscribe($id: String!) {
    issueUnsubscribe(id: $id) {
      success
    }
  }
`);

export interface Subscriber {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export function useIssueSubscribersQuery(issueId: string) {
  return useQuery({
    queryKey: qk.issueSubscribers(issueId),
    queryFn: async (): Promise<Subscriber[]> => {
      const { issue } = await gqlRequest(IssueSubscribersQuery, { id: issueId });
      return issue.subscribers.nodes;
    },
  });
}

// Subscribes or unsubscribes the viewer.
export function useToggleSubscription(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscribe: boolean): Promise<void> => {
      if (subscribe) await gqlRequest(IssueSubscribe, { id: issueId });
      else await gqlRequest(IssueUnsubscribe, { id: issueId });
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.issueSubscribers(issueId) }),
  });
}

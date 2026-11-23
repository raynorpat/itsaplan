// The issue's own reactions, a small query of their own (comment reactions come
// with their comment list). Writes are in @/services/reactions.service.

import { useQuery } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';
import { type ReactionNode } from '@/utils/reactions';

const IssueReactionsQuery = graphql(`
  query IssueReactions($id: String!) {
    issue(id: $id) {
      id
      reactions {
        id
        emoji
        user {
          id
          name
        }
      }
    }
  }
`);

export function useIssueReactionsQuery(issueId: string) {
  return useQuery({
    queryKey: qk.issueReactions(issueId),
    queryFn: async (): Promise<ReactionNode[]> => {
      const { issue } = await gqlRequest(IssueReactionsQuery, { id: issueId });
      return issue.reactions;
    },
  });
}

// Reactions on an issue and its comments, over GraphQL. The issue's own reactions
// are a small query of their own; comment reactions come with the feed. Adding or
// removing one refreshes both, as both keys sit under the issue's feed key.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const ReactionCreate = graphql(`
  mutation IssueReactionCreate($input: ReactionCreateInput!) {
    reactionCreate(input: $input) {
      success
    }
  }
`);

const ReactionDelete = graphql(`
  mutation IssueReactionDelete($id: String!) {
    reactionDelete(id: $id) {
      success
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

// What a reaction is on: the issue itself, or one of its comments.
export type ReactionTarget = { issueId: string; commentId?: string };

// Adds the viewer's reaction, or removes it when `mineId` (the viewer's existing
// reaction with that emoji) is given.
export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      target,
      emoji,
      mineId,
    }: {
      target: ReactionTarget;
      emoji: string;
      mineId: string | null;
    }): Promise<void> => {
      if (mineId) await gqlRequest(ReactionDelete, { id: mineId });
      else
        await gqlRequest(ReactionCreate, {
          input: target.commentId
            ? { commentId: target.commentId, emoji }
            : { issueId: target.issueId, emoji },
        });
    },
    onSettled: (_data, _error, { target }) =>
      void qc.invalidateQueries({ queryKey: qk.feed(target.issueId) }),
  });
}

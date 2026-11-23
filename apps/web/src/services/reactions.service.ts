// Adding and removing reactions over GraphQL, on an issue, a comment or a project
// update. Each refreshes the list the reaction was shown in.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { graphql, gqlRequest } from '@/lib/graphql';
import { qk } from '@/services/queryKeys';

const ReactionCreate = graphql(`
  mutation ReactionCreate($input: ReactionCreateInput!) {
    reactionCreate(input: $input) {
      success
    }
  }
`);

const ReactionDelete = graphql(`
  mutation ReactionDelete($id: String!) {
    reactionDelete(id: $id) {
      success
    }
  }
`);

// What a reaction is on: an issue, a comment (of any comment target) or a project
// update. A comment or an update carries the cache entry that holds its reactions.
export type ReactionTarget =
  | { issueId: string }
  | { commentId: string; refresh: readonly unknown[] }
  | { projectUpdateId: string; refresh: readonly unknown[] };

function reactionInput(target: ReactionTarget, emoji: string) {
  if ('commentId' in target) return { commentId: target.commentId, emoji };
  if ('projectUpdateId' in target) return { projectUpdateId: target.projectUpdateId, emoji };
  return { issueId: target.issueId, emoji };
}

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
      else await gqlRequest(ReactionCreate, { input: reactionInput(target, emoji) });
    },
    onSettled: (_data, _error, { target }) =>
      void qc.invalidateQueries({
        // An issue reaction refreshes only the issue's reactions, not the whole feed.
        queryKey: 'issueId' in target ? qk.issueReactions(target.issueId) : target.refresh,
      }),
  });
}
